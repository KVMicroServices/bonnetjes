# Requirements Document

## Introduction

A comments system for receipts that allows users to discuss individual receipts within the platform. Users can post comments, @-mention other users with autocomplete, and receive notifications when mentioned. Comments are displayed as a threaded conversation on the receipt detail view.

## Glossary

- **Comment_Model**: The Prisma model `Comment` storing comment text, author, receipt reference, and extracted mentions
- **Comment_Service**: The service at `lib/services/comment-service.ts` responsible for creating, listing, and deleting comments
- **Comment_Thread**: The UI component displaying the list of comments for a receipt with a compose input
- **Mention_Autocomplete**: The UI component that appears when a user types `@` in the comment input, showing matching users for selection
- **User_Search_Endpoint**: The API endpoint at `app/api/users/search/route.ts` that returns users matching a query string for mention autocomplete

## Requirements

### Requirement 1: Comment Data Model

**User Story:** As a developer, I want a comment model linked to receipts and users, so that comments are stored with their authorship and mention metadata.

#### Acceptance Criteria

1. THE Comment_Model SHALL store an id (cuid), body (text, maximum 2000 characters), authorId (string referencing User), receiptId (string referencing Receipt), mentions (optional JSON string array of mentioned user IDs), createdAt timestamp defaulting to the current time, and updatedAt timestamp that updates on every modification
2. THE Comment_Model SHALL define a composite index on (receiptId, createdAt) for efficient receipt-scoped queries
3. IF the referenced receipt is deleted, THEN all associated comments SHALL be cascade-deleted
4. IF the referenced author (user) is deleted, THEN all associated comments SHALL be cascade-deleted

### Requirement 2: Comment Service

**User Story:** As a developer, I want a service layer for comment operations, so that API routes stay thin and logic is testable.

#### Acceptance Criteria

1. THE Comment_Service SHALL provide a `createComment` function that accepts receiptId, authorId, body, and optional mentions array, validates the body is non-empty and within 2000 characters, creates the comment record, and returns the created comment with author name and email
2. THE Comment_Service SHALL provide a `getComments` function that accepts a receiptId and returns all comments for that receipt ordered by createdAt ascending, including author id, name, and email for each comment
3. THE Comment_Service SHALL provide an `editComment` function that accepts a commentId, userId, new body, and optional new mentions array, verifies the user is the author, validates the body is non-empty and within 2000 characters, updates the comment record and its mentions, and returns the updated comment with author details
4. THE Comment_Service SHALL provide a `deleteComment` function that accepts a commentId and userId, verifies the user is the author or an admin, and deletes the comment
5. WHEN a comment is created with mentions, THE Comment_Service SHALL trigger a notification for each mentioned user using the existing notification system
6. WHEN a comment is edited and new mentions are added (user IDs not present in the original mentions array), THE Comment_Service SHALL trigger a notification for each newly mentioned user only

### Requirement 3: Comment API Endpoints

**User Story:** As a frontend developer, I want API endpoints for comment CRUD, so that the UI can manage comments.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/receipts/[id]/comments`, THE endpoint SHALL return all comments for that receipt with author details, ordered by createdAt ascending
2. WHEN a POST request is made to `/api/receipts/[id]/comments` with a valid body and optional mentions array, THE endpoint SHALL create the comment and return it with a 201 status
3. WHEN a DELETE request is made to `/api/receipts/[id]/comments/[commentId]`, THE endpoint SHALL delete the comment if the requester is the author or an admin, returning 204 on success
4. WHEN a PATCH request is made to `/api/receipts/[id]/comments/[commentId]` with a valid body and optional mentions array, THE endpoint SHALL update the comment if the requester is the author, returning the updated comment
5. IF the request lacks a valid authenticated session, THEN the endpoint SHALL return a 401 status
6. IF the POST or PATCH body exceeds 2000 characters or is empty, THEN the endpoint SHALL return a 400 status with a validation error

### Requirement 4: User Search Endpoint

**User Story:** As a user, I want to search for other users when typing @, so that I can mention them in comments.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/users/search?q=<query>`, THE endpoint SHALL return up to 10 users whose name or email contains the query string (case-insensitive), returning id, name, and email for each match
2. IF the query string is empty or less than 2 characters, THEN the endpoint SHALL return an empty array
3. IF the request lacks a valid authenticated session, THEN the endpoint SHALL return a 401 status
4. THE endpoint SHALL exclude the requesting user from results

### Requirement 5: Comment Thread UI

**User Story:** As a user, I want to see and post comments on a receipt, so that I can discuss it with other users.

#### Acceptance Criteria

1. THE Comment_Thread SHALL be displayed on the admin page within a receipt detail modal or expandable section, showing all comments for the selected receipt
2. THE Comment_Thread SHALL display each comment with the author's name, a relative timestamp (e.g., "2 minutes ago"), and the comment body with @-mentions rendered as highlighted styled spans showing the mentioned user's name
3. THE Comment_Thread SHALL provide a text input at the bottom for composing new comments, with a submit button that is disabled when the input is empty
4. WHEN a comment is successfully posted, THE Comment_Thread SHALL append it to the list without a full page reload
5. THE Comment_Thread SHALL allow the comment author (or an admin) to delete their own comments via a delete icon, with a confirmation prompt before deletion
6. THE Comment_Thread SHALL allow the comment author to edit their comment via an edit icon, which replaces the comment body with an editable input pre-filled with the existing text, supporting @-mention autocomplete during editing, with save and cancel buttons
7. THE Comment_Thread SHALL display an "(edited)" indicator next to the timestamp for comments that have been modified
8. THE Comment_Thread SHALL use the translation system for all user-visible strings with keys present in all 8 locale files

### Requirement 6: @-Mention Autocomplete

**User Story:** As a user, I want autocomplete suggestions when I type @ in the comment input, so that I can easily mention other users.

#### Acceptance Criteria

1. WHEN the user types `@` followed by at least 2 characters in the comment input, THE Mention_Autocomplete SHALL display a dropdown list of matching users (name and email) fetched from the user search endpoint
2. WHEN the user selects a user from the dropdown (via click or Enter key), THE Mention_Autocomplete SHALL insert the mention as a styled token in the input showing the user's name, and store the user ID in the mentions array for submission
3. THE Mention_Autocomplete SHALL support keyboard navigation (arrow up/down to navigate, Enter to select, Escape to dismiss)
4. THE Mention_Autocomplete SHALL debounce search requests by 300ms to avoid excessive API calls
5. WHEN the dropdown is open and the user continues typing, THE Mention_Autocomplete SHALL filter results in real-time based on the updated query
6. THE Mention_Autocomplete SHALL position the dropdown above or below the cursor based on available viewport space

### Requirement 7: Mention Notifications

**User Story:** As a user, I want to be notified when someone mentions me in a comment, so that I can respond.

#### Acceptance Criteria

1. WHEN a comment is created with mentions, THE system SHALL create a notification of type `comment_mention` for each mentioned user, with the title indicating who mentioned them and the body containing a preview of the comment text (first 100 characters)
2. THE notification type `comment_mention` SHALL be added to the existing notification preferences system, allowing users to choose none, in_app, or email delivery
3. THE notification metadata SHALL include the receiptId and commentId for navigation context
