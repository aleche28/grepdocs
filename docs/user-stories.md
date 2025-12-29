# GrepDocs User Stories

## S1 Authentication & Account

### S1.1 Gmail Auth

As a user, I want to authenticate using my Gmail account so that I can access the application.

### S1.2 Link Github Account

As a user, I want to link my Github account to my application account so that I can access my
private Github repositories.

### S1.3 Link Bitbucket Account

As a user, I want to link my Bitbucket account to my application account so that I can access my
private Bitbucket repositories.

### S1.4 Unlink external accounts

As a user, I want to unlink my Github or Bitbucket account at any time, removing the added private
repositories from those sources.

### S1.5 View linked external accounts

As a user, I want to see which external accounts are currently linked to my profile.

## S2 Repository Management

### S2.1 View available repositories

As a user, I want to see a list of all repositories available from my connected git providers.

### S2.2 Filter available repositories

As a user, I want to see filter the list of all repositories available from my connected git providers.

### S2.3 Track repository

As a user, I want to add a repository to the list of tracked repositories.

### S2.4 Untrack repository

As a user, I want to remove a repository from tracking.

### S2.5 Select tracked branch

As a user, I want to select which branch of repository is tracked.

### S2.6 Pull latest changes

As a user, I want to pull the latest changes from the tracked repository.

## S3 Documentation File Selection

### S3.1 Browse repository files

As a user, I want to browse the file tree of a repository.

### S3.2 Select tracked files

As a user, I want to select one or more files (e.g. README.md, docs/*.md) to be tracked as documentation.

### S3.3 Change tracked files

As a user, I want to change which files are tracked after the repository is added.

### S3.4 Exclude tracked files

As a user, I want to exclude files or directories from tracking.

## S4 Documentation Viewing

### S4.1 View rendered Markdown

As a user, I want to view documentation files rendered as Markdown.

### S4.2 View raw Markdown

As a user, I want to view raw Markdown source.

### S4.3 Navigate files

As a user, I want to navigate between documentation files within the same repository.

### S4.4 View originating branch and repository

As a user, I want to see which repository and branch a documentation file belongs to.

## S5 Search And Indexing

### S5.1 Search documentation by keyword

As a user, I want to search across all tracked documentation by keyword.

### S5.2 Filter search results

As a user, I want to filter search results by repository, group, or provider.

### S5.3 Highlighted matches in search result

As a user, I want to see highlighted matches in search results.

## S6 Editing And Version Control

### S6.1 Edit files in-app

As a user, I want to edit documentation files directly in the app.

### S6.2 Preview Markdown while editing

As a user, I want to preview rendered Markdown while editing.

### S6.3 Commit changes with commit message

As a user, I want to commit my documentation changes back to the repository, optionally providing a commit message.

### S6.4 See diff

As a user, I want to see the diff before committing changes.

### S6.5 Handle merge conflicts

As a user, I want to handle merge conflicts if the file has changed upstream.

## S7 Repository Grouping And Organization

### S7.1 Create groups

As a user, I want to create groups (e.g. “Backend”, “Frontend”, “Internal Tools”).

### S7.2 Assign repositories to groups

As a user, I want to assign repositories to one or more groups.

### S7.3 Search and filter by group

As a user, I want to filter documentation and search results by group.

### S7.4 Rename or delete groups

As a user, I want to rename or delete repository groups.

## S8 Sync And Updates

### S8.1 Trigger repository sync

As a user, I want to manually trigger a sync for a repository.

### S8.2 See last sync status and timestamp

As a user, I want to see the last sync status and timestamp.

### S8.3 Receive warning if syncing fails

As a user, I want to be notified if syncing fails.

### S8.4 Set auto-sync on opening

As a user, I want to set if a sync should be automatically performed on opening the app or not.
