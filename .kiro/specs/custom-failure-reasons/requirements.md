# Requirements Document

## Introduction

Custom Failure Reasons allows admins to create, edit, and manage rejection reasons for receipt verification beyond the built-in set. Each reason has a code and an English description. When the English description changes, the system uses the existing AI API to translate it into the other 7 supported locales (nl, de, fr, es, af, xh, zu). These custom/edited descriptions are used in rejection emails and injected into the OCR prompt so the AI can reference them during verification.

## Glossary

- **Admin**: An authenticated user with `role === "admin"` who can manage system settings
- **Failure_Reason**: A code (e.g. `NOT_A_RECEIPT`) paired with human-friendly descriptions in 8 locales, used to explain why a receipt was rejected
- **Built_In_Reason**: One of the 8 failure reasons currently hardcoded in `FAILURE_REASONS` in `ocr-constants.ts`
- **Custom_Reason**: A failure reason created by an admin, stored in the database rather than in code
- **Translation_Service**: The module that calls the existing OpenAI-compatible AI API to translate English text into the other 7 supported locales
- **Settings_API**: The existing `/api/admin/settings` route that handles admin configuration
- **OCR_Prompt**: The AI prompt used during receipt verification that lists valid failure reasons
- **Email_System**: The email rendering pipeline that resolves a failure reason code to a localized human-friendly sentence

## Requirements

### Requirement 1: Store Custom Failure Reasons

**User Story:** As an admin, I want custom failure reasons persisted in the database, so that they survive deployments and are shared across instances.

#### Acceptance Criteria

1. THE Database SHALL store each failure reason with a unique code (maximum 50 characters), an English description (maximum 500 characters), and translated descriptions (each maximum 500 characters) for each of the 7 non-English locales (nl, de, fr, es, af, xh, zu)
2. THE Database SHALL distinguish between built-in reasons and custom reasons using a boolean `isBuiltIn` flag, where built-in reasons are those whose codes match the 8 codes in `FAILURE_REASONS`
3. WHEN a custom reason is created, THE Database SHALL store the code, English description, and generated translations as a single record with `isBuiltIn` set to false
4. THE Database SHALL enforce uniqueness on the failure reason code via a unique constraint
5. WHEN the application starts and a built-in reason code from `FAILURE_REASONS` does not yet exist in the database, THE Database SHALL be seeded with a record for that code with `isBuiltIn` set to true and the English description populated from the existing hardcoded descriptions

### Requirement 2: Create Custom Failure Reasons

**User Story:** As an admin, I want to add new failure reasons with a code and English description, so that I can tailor rejection reasons to our business needs.

#### Acceptance Criteria

1. WHEN an admin submits a new failure reason with a code and English description, THE Settings_API SHALL validate that the code is non-empty, between 2 and 50 characters, contains only uppercase letters and underscores, does not start or end with an underscore, and is unique across all existing reasons (built-in and custom)
2. WHEN an admin submits a new failure reason, THE Settings_API SHALL validate that the English description is non-empty and does not exceed 500 characters
3. WHEN validation passes, THE Settings_API SHALL persist the new failure reason, trigger translation of the English description, and return the created failure reason record including its code and description
4. IF the code already exists, THEN THE Settings_API SHALL return an error indicating the code is already taken
5. IF the code format is invalid or the description fails validation, THEN THE Settings_API SHALL return an error indicating which field failed and the required format

### Requirement 3: Edit Failure Reason Descriptions

**User Story:** As an admin, I want to edit the English description of any failure reason (built-in or custom), so that I can improve the wording shown to users.

#### Acceptance Criteria

1. WHEN an admin submits an updated English description for an existing failure reason, THE Settings_API SHALL trim leading and trailing whitespace from the submitted description and compare it to the stored description
2. WHEN the trimmed English description differs from the stored description, THE Settings_API SHALL persist the updated description and trigger translation to the other 7 locales
3. WHEN the trimmed English description is identical to the stored description, THE Settings_API SHALL skip translation and return success without modification
4. IF the submitted English description is empty or contains only whitespace after trimming, THEN THE Settings_API SHALL reject the request with an error indicating the description must be between 1 and 500 characters
5. IF the specified failure reason code does not exist in the database or in the built-in reasons, THEN THE Settings_API SHALL return an error indicating the failure reason was not found
6. THE Admin_UI SHALL display the current English description for each failure reason in an editable text field limited to 500 characters

### Requirement 4: AI-Powered Translation

**User Story:** As an admin, I want edited descriptions automatically translated to all supported languages, so that rejection emails are localized without manual effort.

#### Acceptance Criteria

1. WHEN translation is triggered for a failure reason, THE Translation_Service SHALL send a single prompt to the existing OpenAI-compatible AI API containing the English description and all 7 target languages (nl, de, fr, es, af, xh, zu) to produce translations in one request
2. WHEN the AI API returns a successful response containing all 7 translations, THE Translation_Service SHALL store each translated description alongside the English source in the database
3. IF the AI API call fails due to a network error, a non-2xx HTTP response, or a response timeout exceeding 30 seconds, THEN THE Translation_Service SHALL log the error with the failure reason code and retain the previous translations for existing reasons or leave translations empty for new reasons
4. IF the AI API returns a response that cannot be parsed or is missing one or more of the 7 required translations, THEN THE Translation_Service SHALL treat the response as a failure, log the parsing error, and retain the previous translations

### Requirement 5: Email System Integration

**User Story:** As a user receiving a rejection email, I want to see a localized explanation of why my receipt was rejected, so that I understand the decision in my language.

#### Acceptance Criteria

1. WHEN the Email_System resolves a failure reason code for a locale, THE Email_System SHALL query the database for a stored translation matching that code and locale before reading from the message file
2. IF a database translation exists for the requested code and locale, THEN THE Email_System SHALL use the database translation instead of the hardcoded message file value
3. IF no database translation exists for a built-in reason, THEN THE Email_System SHALL fall back to the existing message file translation for that reason and locale
4. IF no database translation exists for a custom reason, THEN THE Email_System SHALL fall back to the English description stored with that custom reason
5. IF the database lookup fails due to a connection or query error, THEN THE Email_System SHALL fall back to the message file translation (for built-in reasons) or the English description (for custom reasons) and log the error

### Requirement 6: OCR Prompt Injection

**User Story:** As an admin, I want custom failure reasons included in the AI verification prompt, so that the OCR model can use them when rejecting receipts.

#### Acceptance Criteria

1. WHEN the OCR prompt is built, THE OCR_Prompt builder SHALL include all enabled failure reasons (built-in and custom) in the failure reason list, rendering each as its code followed by its English description in the same format used for built-in reasons
2. WHEN the OCR prompt is built, THE OCR_Prompt builder SHALL read enabled custom reasons from the database and merge them with enabled built-in reasons before assembling the failure reason list
3. WHEN a custom reason is disabled via the existing toggle, THE OCR_Prompt builder SHALL exclude it from the prompt
4. IF the database is unreachable when reading custom reasons at prompt build time, THEN THE OCR_Prompt builder SHALL fall back to using only the enabled built-in failure reasons and log the error

### Requirement 7: Delete Custom Failure Reasons

**User Story:** As an admin, I want to delete custom failure reasons I no longer need, so that the list stays manageable.

#### Acceptance Criteria

1. WHEN an admin deletes a custom failure reason, THE Settings_API SHALL remove the reason and its translations from the database and return a success response
2. IF an admin attempts to delete a built-in failure reason (whose code matches one of the 8 codes in `FAILURE_REASONS`), THEN THE Settings_API SHALL reject the request with an error indicating that built-in reasons cannot be deleted
3. IF an admin attempts to delete a failure reason code that does not exist in the database, THEN THE Settings_API SHALL return an error indicating the reason was not found
4. WHEN a deleted reason code exists on previously processed receipts, THE Database SHALL retain the code on those receipt records unchanged
5. THE Admin_UI SHALL display a delete action only for custom reasons
6. WHEN an admin activates the delete action, THE Admin_UI SHALL display a confirmation prompt before sending the delete request to the Settings_API

### Requirement 8: AI-Generated Description from Code

**User Story:** As an admin, I want to generate a human-friendly English description from a failure reason code with one click, so that I don't have to write it manually.

#### Acceptance Criteria

1. THE Admin_UI SHALL display a "Generate" button next to the English description field for each failure reason (new or existing)
2. WHEN an admin clicks the Generate button, THE Settings_API SHALL call the AI API with the failure reason code and return a suggested English description suitable for use in customer-facing rejection emails
3. WHEN the AI returns a suggestion, THE Admin_UI SHALL populate the English description field with the generated text without auto-saving, allowing the admin to review and edit before saving
4. IF the AI API call fails, THEN THE Admin_UI SHALL display an error notification and leave the description field unchanged
5. WHILE the generation is in progress, THE Admin_UI SHALL display a loading indicator on the Generate button and disable it

### Requirement 9: Admin UI for Failure Reason Management

**User Story:** As an admin, I want a section in the settings page to manage failure reasons, so that I can create, edit, and delete them in one place.

#### Acceptance Criteria

1. THE Admin_UI SHALL display all failure reasons (built-in and custom) in a list showing each reason's code, English description, enabled/disabled status, and whether it is built-in or custom
2. THE Admin_UI SHALL provide a form to add a new custom failure reason with a code field (maximum 50 characters) and an English description field (maximum 500 characters)
3. THE Admin_UI SHALL provide inline editing of the English description for each failure reason (built-in and custom)
4. WHILE a translation is in progress for a failure reason, THE Admin_UI SHALL display a loading indicator on that specific reason's row and disable editing for that row
5. WHEN a save completes with translation, THE Admin_UI SHALL display a success toast notification and update the failure reason list to reflect the saved changes
6. IF a create, edit, or delete operation fails, THEN THE Admin_UI SHALL display an error notification indicating the operation that failed and preserve the user's unsaved input
