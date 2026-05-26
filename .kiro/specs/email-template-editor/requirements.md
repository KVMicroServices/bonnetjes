# Requirements Document

## Introduction

Email Template Editor allows admins to customize the text content of all transactional emails (disable/reject, receipt verified, dispute verified, final rejection) from the admin settings page. Admins edit translation keys in a source language, click "Auto-translate" to generate the other 7 locale versions via the existing AI API, and preview the rendered email in a modal with an iframe. Overrides are stored in the database and take precedence over the hardcoded `messages/*.json` values at send time.

## Glossary

- **Email_Type**: One of the three email template categories: `disable` (review disabled/receipt rejected), `verified` (receipt or dispute verified), `finalRejection` (dispute final rejection)
- **Translation_Key**: A named string slot within an email template (e.g. `subject`, `greeting`, `body`)
- **Override**: A database-stored value for a specific email type + translation key + locale that replaces the default from `messages/*.json`
- **Source_Language**: The language the admin edits in (any of the 8 supported locales, defaulting to English)
- **Auto_Translate**: A one-click action that sends the source language value to the AI API and generates translations for the other 7 locales
- **Preview_Modal**: A modal dialog showing the rendered email HTML in an iframe using current override values and sample data
- **Admin_Settings_API**: The existing `/api/admin/settings` route and related admin-only endpoints

## Requirements

### Requirement 1: Store Email Template Overrides

**User Story:** As an admin, I want email text overrides persisted in the database, so that customizations survive deployments and are shared across instances.

#### Acceptance Criteria

1. THE Database SHALL store each override as a record with: email type (string, one of `disable`, `verified`, `disputeVerified`, `finalRejection`), translation key (string), locale (string, one of the 8 supported locales), and value (text, maximum 2000 characters)
2. THE Database SHALL enforce a unique constraint on the combination of (emailType, translationKey, locale)
3. WHEN an admin saves an override, THE System SHALL upsert the record for that (emailType, key, locale) combination
4. WHEN an admin saves an override with an empty value, THE System SHALL delete the override record so the default from `messages/*.json` is used

### Requirement 2: Edit Email Template Keys

**User Story:** As an admin, I want to edit the text content of any email template field, so that I can customize the wording without code changes.

#### Acceptance Criteria

1. THE Admin_UI SHALL display a dropdown to select the email type being edited, with options for all four email types
2. WHEN an email type is selected, THE Admin_UI SHALL display all translation keys for that type as editable text fields, pre-populated with the current override value (if one exists) or the default value from `messages/en.json`
3. THE Admin_UI SHALL display a human-readable label for each translation key so admins understand what each field controls
4. WHEN an admin modifies a field and clicks Save, THE System SHALL persist the override for the source language locale and return success
5. THE Admin_UI SHALL display a success toast on save and an error toast if the save fails

### Requirement 3: Auto-Translate Overrides

**User Story:** As an admin, I want to auto-translate only the fields I changed to all other supported languages with one click, so that emails are localized without wasting API calls on unchanged text.

#### Acceptance Criteria

1. THE Admin_UI SHALL track which keys have been modified since the last save (dirty keys) and display an "Auto-translate" button that is enabled only when at least one dirty key exists
2. WHEN auto-translate is triggered, THE System SHALL send only the dirty keys' values to the AI API and store the returned translations as overrides for the corresponding (emailType, key, locale) combinations — unchanged keys are not re-translated
3. WHILE translation is in progress, THE Admin_UI SHALL display a loading indicator and disable the auto-translate button
4. WHEN translation completes successfully, THE Admin_UI SHALL display a success toast indicating how many keys were translated and clear the dirty state for those keys
5. IF the AI API call fails for any key, THE System SHALL log the error, skip that key, and report partial success to the admin indicating which keys failed

### Requirement 4: Email Preview Modal

**User Story:** As an admin, I want to preview how the email will look before saving, so that I can verify my changes are correct.

#### Acceptance Criteria

1. THE Admin_UI SHALL display a "Preview" button that opens a modal dialog
2. WHEN the preview modal opens, THE System SHALL render the email HTML using the current override values (including unsaved edits in the form) merged with sample placeholder data for dynamic fields (e.g. dispute URL, shop name, amount)
3. THE Preview_Modal SHALL display the rendered email in an iframe so that email styles do not leak into the admin page
4. THE Preview_Modal SHALL display the email subject line above the iframe
5. THE Preview_Modal SHALL be dismissible via a close button or clicking outside

### Requirement 5: Email System Integration

**User Story:** As a user receiving a transactional email, I want to see the admin-customized text, so that the email reflects the latest wording set by the team.

#### Acceptance Criteria

1. WHEN the email translation loader resolves a key for a given email type and locale, THE System SHALL query the database for an override matching that (emailType, key, locale) before reading from the message file
2. IF a database override exists and is non-empty, THE System SHALL use the override value instead of the message file value
3. IF no database override exists, THE System SHALL fall back to the existing message file translation behavior
4. IF the database lookup fails due to a connection error, THE System SHALL fall back to the message file value and log the error
5. THE System SHALL not cache overrides indefinitely — each email send SHALL read the current override values (acceptable to cache for the duration of a single email render)

### Requirement 6: Admin UI Layout

**User Story:** As an admin, I want the email template editor accessible from the settings page, so that I can manage email content alongside other system configuration.

#### Acceptance Criteria

1. THE Admin_Settings page SHALL include an "Email Templates" section with the email type dropdown, translation key fields, save button, auto-translate button, and preview button
2. THE Admin_UI SHALL use the existing settings page layout patterns (card-based sections, consistent spacing, shadcn/ui components)
3. ALL user-visible strings in the email template editor UI SHALL use the translation system with a dedicated namespace
