# GrepDocs Requirements

## Description

The goal of this project is to provide a centralized tool to browse, search, and edit documentation that lives directly inside git repositories.

In many projects, documentation is spread across multiple repositories in files such as README.md or other Markdown documents. This application allows users to add repositories, select which files should be tracked as documentation, and manage them from a single interface.

Tracked documentation can be rendered as Markdown, searched globally (grep-style), edited in place, and committed back to the original repository. Changes made in the application are pushed directly to source control.

The application initially supports GitHub and Bitbucket and allows repositories to be organized into groups.

Users authenticate with Gmail and can optionally link their GitHub and Bitbucket accounts.

GitHub repositories can be added without authentication (public repositories only) or with authentication (public and private repositories).

Bitbucket repositories can be added only when a Bitbucket account is linked, and only private repositories are supported.

## Functional Requirements

### FR1 Core Features

- OAuth-based authentication for GitHub and Bitbucket

- Repository discovery and selection

- Branch selection per repository

- Documentation file discovery and tracking

- Markdown rendering and raw view

- Full-text search across tracked documentation

- Inline documentation editing

- Git commit and push support

- Repository grouping

### FR2 Git Provider Support

- GitHub API integration

- Bitbucket API integration

- Support for:

  - Repository listing

  - File tree browsing

  - File read/write

  - Commit creation

### FR3 Search and Indexing

- Index Markdown content for fast search

- Support multi-repository search

- Incremental reindexing on updates

### FR4 Sync and Data Handling

- Clone or shallow-fetch repositories

- Cache documentation content locally or in storage

- Periodic or manually-triggered synchronization

- Conflict detection on commit

### FR5 UI/UX Requirements

- Clear repository and group navigation

- Split view for editing (source + preview)

- Search-first UX for large documentation sets

- Visual indicators for sync and commit status

## Non-Functional Requirements

- Secure token storage

- Scalable indexing for many repositories

- Reasonable performance for large Markdown files

- Extensible provider system (GitLab later)

- Auditability of edits and commits
