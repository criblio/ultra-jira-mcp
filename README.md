# Jira MCP Server

A Model Context Protocol (MCP) server that provides AI models with full access to Jira Cloud functionality via the REST API v3 and Agile API 1.0.

## Installation

```bash
npx jira-mcp
```

Or install globally:

```bash
npm install -g jira-mcp
```

## Configuration

Set the following environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `JIRA_HOST` | Your Jira instance URL (e.g., `https://yourcompany.atlassian.net`) | Yes |
| `JIRA_EMAIL` | Your Atlassian account email | Yes |
| `JIRA_API_TOKEN` | API token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens) | Yes |
| `JIRA_ENABLED_CATEGORIES` | Comma-separated list of tool categories to enable (default: all) | No |
| `JIRA_DISABLED_TOOLS` | Comma-separated list of specific tools to disable | No |

### Tool Filtering

You can limit which tools are exposed to the AI model using environment variables:

**Enable only specific categories:**
```bash
JIRA_ENABLED_CATEGORIES=issue,search,project
```

**Disable specific tools (e.g., destructive operations):**
```bash
JIRA_DISABLED_TOOLS=jira_delete_issue,jira_delete_project,jira_delete_comment
```

**Available categories:** `issue`, `search`, `project`, `user`, `board`, `sprint`, `epic`, `comment`, `attachment`, `worklog`, `issueLink`, `watcher`, `field`, `filter`, `group`, `server`

## Claude Desktop Setup

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-mcp"],
      "env": {
        "JIRA_HOST": "https://yourcompany.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

**With tool filtering (recommended for limited access):**
```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-mcp"],
      "env": {
        "JIRA_HOST": "https://yourcompany.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_ENABLED_CATEGORIES": "issue,search,project,comment",
        "JIRA_DISABLED_TOOLS": "jira_delete_issue,jira_delete_project"
      }
    }
  }
}
```

## Available Tools

### Issues
- `jira_get_issue` - Get issue details
- `jira_create_issue` - Create a new issue
- `jira_update_issue` - Update an existing issue
- `jira_delete_issue` - Delete an issue
- `jira_bulk_create_issues` - Create multiple issues
- `jira_get_issue_transitions` - Get available transitions
- `jira_transition_issue` - Transition issue to new status
- `jira_assign_issue` - Assign issue to user
- `jira_get_issue_changelogs` - Get issue change history

### Search
- `jira_search_issues` - Search issues using JQL
- `jira_get_jql_autocomplete` - Get JQL autocomplete suggestions

### Projects
- `jira_list_projects` - List all accessible projects
- `jira_get_project` - Get project details
- `jira_create_project` - Create a new project
- `jira_update_project` - Update project
- `jira_delete_project` - Delete project
- `jira_get_project_components` - List project components
- `jira_create_component` - Create component
- `jira_get_project_versions` - List project versions
- `jira_create_version` - Create version
- `jira_update_version` - Update version
- `jira_get_project_statuses` - Get project statuses

### Users
- `jira_get_current_user` - Get authenticated user
- `jira_search_users` - Search for users
- `jira_get_user` - Get user by account ID
- `jira_get_assignable_users` - Find assignable users
- `jira_bulk_get_users` - Get multiple users

### Boards (Agile)
- `jira_list_boards` - List all boards
- `jira_get_board` - Get board details
- `jira_create_board` - Create a new board
- `jira_delete_board` - Delete board
- `jira_get_board_configuration` - Get board configuration
- `jira_get_board_issues` - Get issues on board
- `jira_get_board_backlog` - Get board backlog
- `jira_get_board_epics` - Get epics on board

### Sprints (Agile)
- `jira_list_sprints` - List sprints for board
- `jira_get_sprint` - Get sprint details
- `jira_create_sprint` - Create new sprint
- `jira_update_sprint` - Update sprint
- `jira_delete_sprint` - Delete sprint
- `jira_get_sprint_issues` - Get issues in sprint
- `jira_move_issues_to_sprint` - Move issues to sprint
- `jira_move_issues_to_backlog` - Move issues to backlog

### Epics (Agile)
- `jira_get_epic` - Get epic details
- `jira_get_epic_issues` - Get issues in epic
- `jira_move_issues_to_epic` - Add issues to epic
- `jira_remove_issues_from_epic` - Remove issues from epic

### Comments
- `jira_get_comments` - Get issue comments
- `jira_add_comment` - Add comment to issue
- `jira_update_comment` - Update comment
- `jira_delete_comment` - Delete comment

### Attachments
- `jira_get_attachment` - Get attachment metadata
- `jira_delete_attachment` - Delete attachment
- `jira_get_attachment_content` - Download attachment
- `jira_get_attachment_meta` - Get attachment settings

### Worklogs
- `jira_get_worklogs` - Get worklogs for issue
- `jira_add_worklog` - Add worklog entry
- `jira_update_worklog` - Update worklog
- `jira_delete_worklog` - Delete worklog

### Issue Links
- `jira_create_issue_link` - Link two issues
- `jira_get_issue_link` - Get issue link details
- `jira_delete_issue_link` - Delete issue link
- `jira_get_issue_link_types` - List available link types

### Watchers & Voters
- `jira_get_watchers` - Get issue watchers
- `jira_add_watcher` - Add watcher to issue
- `jira_remove_watcher` - Remove watcher
- `jira_get_votes` - Get votes on issue
- `jira_add_vote` - Add vote to issue
- `jira_remove_vote` - Remove vote

### Fields & Metadata
- `jira_get_fields` - Get all fields
- `jira_get_issue_types` - Get all issue types
- `jira_get_priorities` - Get all priorities
- `jira_get_statuses` - Get all statuses
- `jira_get_resolutions` - Get all resolutions
- `jira_get_create_metadata` - Get fields required to create issues

### Filters
- `jira_list_filters` - Search/list filters
- `jira_get_filter` - Get filter details
- `jira_create_filter` - Create saved filter
- `jira_update_filter` - Update filter
- `jira_delete_filter` - Delete filter
- `jira_get_favourite_filters` - Get favorite filters

### Groups & Permissions
- `jira_search_groups` - Search for groups
- `jira_get_group_members` - Get group members
- `jira_get_my_permissions` - Get current user permissions

### Server
- `jira_get_server_info` - Get Jira server info

## Available Resources

- `jira://projects` - List of all accessible projects
- `jira://project/{key}` - Project details
- `jira://issue/{key}` - Issue details
- `jira://boards` - List of all boards
- `jira://board/{id}` - Board details
- `jira://sprint/{id}` - Sprint details
- `jira://myself` - Current user info

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with inspector
npm run inspector
```

## License

MIT
