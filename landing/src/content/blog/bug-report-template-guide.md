---
title: "The Perfect Bug Report Template (With Examples and Free Download)"
description: "Copy-paste bug report templates for Jira, GitHub, Linear, and more. Learn what makes a great bug report with real examples and best practices."
date: 2026-03-15
author: "BugReel Team"
image: "/og-image.png"
tags: ["bug-report", "template", "qa", "best-practices"]
---

Every developer has opened a bug report that says "it doesn't work" and nothing else. No steps, no screenshots, no environment details. Just three words and a prayer that someone on the team can figure out what went wrong.

The cost of bad bug reports is staggering. Studies show that developers spend up to 50% of their debugging time simply trying to reproduce the issue. Multiply that across every bug ticket in a sprint, and you're looking at days of lost engineering time every month — not because the bugs are hard to fix, but because nobody explained what happened clearly enough.

This guide gives you everything you need to fix that: copy-paste templates for every major issue tracker, real examples of good and bad bug reports, a severity matrix you can adopt today, and practical tips for building a bug reporting culture that actually works.

## Why Most Bug Reports Fail

Before we look at templates, let's understand why bug reports go wrong. The three most common failure modes account for the vast majority of rejected or stalled tickets.

### The "Can't Reproduce" Problem

"Can't reproduce" is the number-one reason bugs sit in backlog purgatory. The reporter saw the bug, but the developer can't make it happen again. This almost always traces back to missing steps or skipped context. The reporter assumes the developer knows the starting state, the specific data they were using, or the exact sequence of clicks. They don't.

A bug report that says "the save button doesn't work" could mean a dozen different things. Does it not respond to clicks? Does it trigger an error? Does it save the wrong data? Does it work on the second try? Without specifics, the developer is left guessing — and guessing means wasted time.

### Missing Context

Browser, operating system, screen resolution, user role, account type, feature flags — all of these can affect whether a bug manifests. A layout issue that only appears in Safari on iOS 17 will never be found by a developer testing in Chrome on macOS. An API error that only triggers for free-tier users won't show up in a staging environment with admin credentials.

Context isn't optional. It's the difference between a 5-minute fix and a 2-day investigation.

### No Visual Evidence

Text descriptions of visual bugs are almost always insufficient. "The modal is misaligned" could mean it's 2 pixels off or it's covering the entire screen. A screenshot removes all ambiguity. A video recording removes even more — it shows the sequence of events, the timing, and the exact moment things went wrong.

Teams that adopt screenshots and video as standard practice in bug reports see significantly faster resolution times. It's not a nice-to-have. It's the single highest-impact improvement you can make to your bug reporting process.

## Anatomy of a Perfect Bug Report

Every great bug report answers the same eight questions. Miss any one of them, and you risk the "can't reproduce" outcome. Here's what each component contributes and why it matters.

### Title

The title is a search index. It should be specific enough that someone scanning a list of 200 tickets can identify this exact bug without opening it. "Button broken" is useless. "Save button returns 500 error when description contains emoji characters" is searchable, scannable, and immediately informative.

**Formula:** `[Component] + [What's Wrong] + [When/Condition]`

### Environment

The environment section answers "where did this happen?" It eliminates an entire category of debugging dead ends.

Include:
- **Browser and version** (Chrome 124, Safari 17.4, Firefox 126)
- **Operating system** (macOS 15.2, Windows 11 23H2, iOS 18.1)
- **App version or build** (v2.4.1, commit abc123, staging environment)
- **Screen resolution** (if it's a layout bug)
- **User role and account type** (admin, free tier, enterprise)

### Steps to Reproduce

This is the most important section. Number each step. Start from a known state. Be absurdly specific.

Bad: "Go to settings and change the name."

Good:
1. Log in as a free-tier user (test@example.com)
2. Navigate to Settings > Profile
3. Clear the "Display Name" field completely
4. Type a new name containing a special character (e.g., "O'Brien")
5. Click "Save Changes"

The difference is that the good version can be followed by anyone on the team — including someone who has never used the feature before. That's the bar.

### Expected Behavior

What should happen if the software were working correctly? This seems obvious, but it's often missing — and it matters because the developer may not know the intended behavior. State it explicitly: "The name should save successfully and display on the profile page."

### Actual Behavior

What actually happened instead? Be precise: "Clicking Save triggers a 500 Internal Server Error. The page shows a generic error toast. The name is not saved."

### Screenshots and Video

Attach visual evidence. For UI bugs, a screenshot is the minimum. For interaction bugs (hover states, animations, multi-step flows), video is dramatically more useful. Annotate your screenshots to highlight the problem area — a red circle or arrow takes two seconds and saves minutes of confusion.

### Severity and Priority

Severity describes impact. Priority describes urgency. They're not the same thing (more on this below). Include both so the team can triage effectively.

### Additional Context

This is the catch-all for anything else that helps: console errors, network request/response pairs, related tickets, workarounds you've found, or whether the bug is intermittent vs. consistent.

## Bug Report Templates (Copy-Paste Ready)

Here are ready-to-use templates for every major issue tracker. Copy the one that matches your tool and customize it for your team.

### Universal Markdown Template

This works everywhere — paste it into any tracker that supports Markdown.

```markdown
## Bug Report

**Title:** [Component] — [What's Wrong] [When/Condition]

### Environment
- **Browser:** Chrome 124 / Safari 17.4 / Firefox 126
- **OS:** macOS 15.2 / Windows 11 / iOS 18.1
- **App Version:** v2.4.1 / staging / production
- **User Role:** Admin / Member / Free Tier
- **Screen Resolution:** 1920x1080

### Steps to Reproduce
1. [Starting state — what page/screen are you on?]
2. [First action]
3. [Second action]
4. [Continue until the bug occurs]

### Expected Behavior
[What should happen if the software were working correctly]

### Actual Behavior
[What actually happened — be specific about error messages, visual glitches, etc.]

### Screenshots / Video
[Attach screenshots or video recording here]

### Severity
- [ ] Critical — System down, data loss, security vulnerability
- [ ] High — Major feature broken, no workaround
- [ ] Medium — Feature broken, workaround exists
- [ ] Low — Minor visual issue, cosmetic

### Additional Context
- **Console Errors:** [Paste any errors from browser DevTools]
- **Network Errors:** [Note any failed API calls, status codes]
- **Frequency:** Always / Intermittent (approx. X out of Y attempts)
- **Workaround:** [If one exists, describe it]
- **Related Issues:** [Link to any related tickets]
```

### Jira Template

Paste this into a Jira ticket description. It uses Jira's wiki markup for compatibility with both classic and next-gen projects.

```
h3. Environment
* *Browser:* Chrome 124
* *OS:* macOS 15.2
* *App Version:* v2.4.1
* *User Role:* Admin
* *URL:* https://app.example.com/settings/profile

h3. Steps to Reproduce
# [Starting state]
# [First action]
# [Second action]
# [Action that triggers the bug]

h3. Expected Behavior
[What should happen]

h3. Actual Behavior
[What actually happened]

h3. Screenshots / Video
!screenshot.png|thumbnail!

h3. Severity
*Critical / High / Medium / Low*

h3. Additional Context
* *Console Errors:* {code}paste errors here{code}
* *Frequency:* Always / Intermittent
* *Workaround:* [If any]
```

**Jira tip:** Create this as an issue template in your project settings. Go to Project Settings > Issue Types > Bug, and paste this into the default description field. Every new bug ticket will start pre-filled with these sections.

### GitHub Issues Template

Save this as `.github/ISSUE_TEMPLATE/bug_report.md` in your repository. GitHub will automatically show it when someone opens a new issue.

```markdown
---
name: Bug Report
about: Report a bug to help us improve
title: "[BUG] "
labels: bug
assignees: ''
---

## Environment
- **Browser:**
- **OS:**
- **App Version / Commit:**
- **User Role / Account Type:**

## Steps to Reproduce
1.
2.
3.

## Expected Behavior


## Actual Behavior


## Screenshots / Video


## Severity
<!-- Choose one -->
- [ ] Critical — System down, data loss, security vulnerability
- [ ] High — Major feature broken, no workaround
- [ ] Medium — Feature broken, workaround exists
- [ ] Low — Minor visual issue, cosmetic

## Additional Context
<!-- Console errors, network logs, related issues, workarounds -->

```

**GitHub tip:** You can also use GitHub's YAML-based issue forms for an even more structured experience. Issue forms render as actual input fields rather than a Markdown template, which means reporters can't accidentally delete the template structure.

### Linear Template

Linear doesn't support issue templates natively, but you can create a saved template through their API or use this as a standardized format your team agrees on.

```markdown
**Environment:** Chrome 124, macOS 15.2, v2.4.1, Admin user

**Steps to Reproduce:**
1. [Starting state]
2. [Action]
3. [Action that triggers the bug]

**Expected:** [What should happen]

**Actual:** [What happened — include error messages]

**Evidence:** [Screenshot or video link]

**Severity:** Critical / High / Medium / Low

**Console/Network:**
```

**Linear tip:** Linear's compact style favors shorter descriptions. Keep each section to one or two lines and attach media separately. Use Linear labels for severity rather than including it in the description.

## Real Bug Report Examples

Templates are a starting point. To see what "good" actually looks like, let's compare real examples side by side.

### Bad Example vs. Good Example

**Bad bug report:**

> **Title:** Login broken
>
> **Description:** I tried to log in and it didn't work. Please fix ASAP.

This tells the developer almost nothing. Which login page? What credentials? What happened — an error message, a blank screen, a redirect loop? "Didn't work" could mean anything.

**Good bug report:**

> **Title:** Login form returns "Invalid credentials" for SSO users after password reset
>
> **Environment:** Chrome 124, macOS 15.2, Production (app.example.com)
>
> **Steps to Reproduce:**
> 1. Go to https://app.example.com/login
> 2. Click "Sign in with Google"
> 3. Complete Google OAuth flow with an account that recently reset its password (within last 24 hours)
> 4. Get redirected back to the app
>
> **Expected:** User should be logged in and redirected to the dashboard
>
> **Actual:** App displays "Invalid credentials" error. The URL shows `?error=auth_failed`. Refreshing the page shows the login form again. Logging in with email/password for the same account works fine.
>
> **Screenshot:** [attached — shows the error toast and URL parameter]
>
> **Severity:** High — Affects all SSO users who've reset their password. No workaround except switching to email/password login temporarily.
>
> **Additional context:** Checked the browser console — there's a 401 response from `/api/auth/callback` with body `{"error": "token_expired"}`. This might be related to the session token not being refreshed after the Google-side password reset.

The second report can be acted on immediately. The developer knows exactly what to investigate, has a likely root cause to start with, and can reproduce the issue in minutes.

### UI Bug Example

> **Title:** Dropdown menu clips behind the modal overlay on the "Assign Member" dialog
>
> **Environment:** Firefox 126, Windows 11, v2.4.1, 1366x768 resolution
>
> **Steps to Reproduce:**
> 1. Open any project page
> 2. Click "Add Task"
> 3. In the task creation modal, click the "Assign to" dropdown
> 4. Scroll down in the dropdown list
>
> **Expected:** The dropdown should render above the modal overlay and be fully visible and scrollable.
>
> **Actual:** The dropdown renders behind the modal's overflow boundary. Items below the 5th entry are cut off and unreachable. See screenshot — the red arrow shows where the list is clipped.
>
> **Screenshot:** [attached — annotated with clipping area highlighted]
>
> **Severity:** Medium — Users can't assign tasks to team members listed below the fold. Workaround: use the search field within the dropdown to filter to the desired person.
>
> **Additional context:** This only happens when the modal is near the bottom of the viewport. If the browser window is tall enough (>900px height), the dropdown fits. Likely a z-index or overflow:hidden issue on the modal container.

### API Bug Example

> **Title:** PATCH /api/projects/:id returns 200 but doesn't persist the "description" field update
>
> **Environment:** Production API (api.example.com), tested via curl and the web app
>
> **Steps to Reproduce:**
> 1. Send a PATCH request to `/api/projects/42` with body: `{"description": "Updated description"}`
> 2. Send a GET request to `/api/projects/42`
>
> **Expected:** GET response should include `"description": "Updated description"`
>
> **Actual:** GET response still shows the old description. The PATCH returns 200 with the updated object in the response body, but the change is not persisted to the database.
>
> **Severity:** High — Project descriptions cannot be updated. This affects all users.
>
> **Additional context:**
> ```
> # Request
> curl -X PATCH https://api.example.com/api/projects/42 \
>   -H "Authorization: Bearer <token>" \
>   -H "Content-Type: application/json" \
>   -d '{"description": "Updated description"}'
>
> # Response (200 OK)
> {"id": 42, "name": "My Project", "description": "Updated description"}
>
> # Subsequent GET
> curl https://api.example.com/api/projects/42 \
>   -H "Authorization: Bearer <token>"
>
> # Response (200 OK)
> {"id": 42, "name": "My Project", "description": "Old description text"}
> ```
> Updating the `name` field works correctly. Only `description` is affected. Possible that `description` is not in the model's `$fillable` array or is being overwritten by a post-save hook.

### Performance Bug Example

> **Title:** Dashboard page takes 12+ seconds to load for accounts with 500+ projects
>
> **Environment:** Chrome 124, macOS 15.2, Production, Enterprise account (account_id: 7891)
>
> **Steps to Reproduce:**
> 1. Log in as an enterprise user with 500+ projects (test account: enterprise-test@example.com)
> 2. Navigate to the Dashboard page
> 3. Observe load time
>
> **Expected:** Dashboard should load within 2-3 seconds regardless of project count.
>
> **Actual:** Page shows a loading spinner for 12-14 seconds. During this time, the browser tab becomes unresponsive. After loading, scrolling is janky.
>
> **Severity:** High — Enterprise customers (our highest-paying tier) have the worst experience.
>
> **Additional context:**
> - Network tab shows a single API call to `/api/dashboard/summary` that takes 11.2 seconds
> - Response payload is 4.8 MB — it appears to return every project with full details instead of paginated summaries
> - Accounts with <50 projects load in under 1 second
> - This likely regressed after the v2.4.0 release (it was fine on v2.3.x)
> - DevTools Performance recording attached showing a long task on the main thread during JSON parsing

## Bug Severity and Priority Matrix

One of the most common mistakes in bug triage is conflating severity with priority. They measure different things, and separating them leads to better decisions.

**Severity** is about impact — how badly does this bug affect users?

**Priority** is about urgency — how soon should we fix it?

A critical-severity bug in an admin panel used by three internal people might be low priority. A low-severity typo on the homepage pricing page might be high priority because it affects conversion. Keeping these axes separate gives your team the information to triage intelligently.

### Severity Definitions

| Severity | Definition | Examples |
|---|---|---|
| **Critical** | System unusable, data loss, or security vulnerability. Affects all or most users. No workaround. | Login completely broken; payments charging wrong amounts; SQL injection vulnerability; data being deleted unexpectedly |
| **High** | Major feature broken or significantly degraded. Affects many users. No reasonable workaround. | Search returns wrong results; file upload fails for files over 1MB; user permissions not enforced correctly |
| **Medium** | Feature broken but a workaround exists. Affects some users or a non-critical workflow. | Export to CSV includes wrong column headers; date picker doesn't work in Safari (manual entry works); sorting is reversed on one table |
| **Low** | Minor visual issue, cosmetic defect, or edge case. Minimal user impact. | Button alignment off by a few pixels; tooltip shows raw HTML; animation stutter on page transition |

### Priority Definitions

| Priority | Definition | Response Time |
|---|---|---|
| **P0 / Urgent** | Fix immediately. Drop everything. | Hours |
| **P1 / High** | Fix in the current sprint. | Days |
| **P2 / Medium** | Fix in the next sprint or two. | 1-3 weeks |
| **P3 / Low** | Fix when convenient. Backlog. | When capacity allows |

### How to Assess Severity

Ask these four questions:

1. **Scope:** How many users are affected? All users = Critical. One user with a rare config = Low.
2. **Impact:** What's the consequence? Data loss = Critical. Visual glitch = Low.
3. **Workaround:** Can users achieve their goal another way? No workaround pushes severity up one level.
4. **Frequency:** Does it happen every time or once in a hundred? Consistent reproduction = higher severity.

### The Common Mistake

Teams that use a single "Priority" field end up in arguments. The product manager wants to prioritize based on business impact. The developer wants to prioritize based on technical severity. The QA engineer wants to prioritize based on how many users are complaining.

With two separate fields, everyone gets the information they need. The severity is a fact. The priority is a decision. Separate them, and triage meetings get shorter.

## Tools That Generate Bug Reports Automatically

Templates solve the structure problem — but they don't solve the effort problem. A template still requires someone to manually fill in every section: take screenshots, copy console errors, write up steps, and format everything for the tracker. On a busy day, that effort is exactly why people skip sections or write "see attached video" and nothing else.

### The Manual Approach: Templates + Screenshots

The template approach we've covered in this guide is a solid foundation. Combined with a screenshot tool (like your OS's built-in capture or a tool like CleanShot), it covers the basics. For teams that file a few bugs per week, this is often enough.

The workflow looks like:

1. Notice the bug
2. Take a screenshot or start a screen recording
3. Open your issue tracker
4. Fill in the template fields
5. Attach the media
6. Submit

Total time: 5-10 minutes per bug report, assuming you remember all the details.

### The Automated Approach: AI-Powered Capture

A newer category of tools takes a different approach: record your screen while you reproduce the bug, then use AI to automatically extract the steps, identify key moments for screenshots, capture technical context (console logs, network requests), and generate the structured report for you.

This reduces the 5-10 minute process to under a minute. You hit Record, reproduce the bug while narrating what you see, and the tool produces a complete bug report ready for your tracker.

Tools like [BugReel](https://bugreel.com) take this approach — you record the reproduction, and AI generates the steps, screenshots, severity assessment, and formatted report. The result is a bug report that's more detailed and consistent than what most people write manually, in a fraction of the time.

### When to Use Which

- **Small teams, low bug volume:** Templates are sufficient. The overhead of setting up a new tool isn't worth it when you file 5-10 bugs a month.
- **Growing teams, increasing bug volume:** Automated tools pay for themselves quickly. When your team files 50+ bugs a month, the time savings compound.
- **QA teams with non-technical reporters:** Automated tools are transformative. People who struggle to write clear steps can just record their screen and let the AI handle the rest.

## Tips for QA Teams

Templates and tools are only as good as the habits around them. Here are seven practices that separate high-performing QA teams from the rest.

### 1. Consistency Matters More Than Perfection

A mediocre bug report that uses the template every time is better than an occasional masterpiece surrounded by sloppy tickets. Push for consistency first. Quality follows naturally once the habit is established.

Set a simple rule: no bug ticket gets submitted without the five required fields filled in (title, steps, expected, actual, severity). If any field is empty, the ticket gets bounced back. It sounds strict, but after a week, people internalize it and the quality bar stays up permanently.

### 2. Record Video, Don't Just Screenshot

Screenshots capture a moment. Video captures a sequence. For any bug that involves multiple steps, timing, or interaction (which is most bugs), video is dramatically more useful.

Modern screen recording is trivial — every OS has it built in, and dedicated tools add console capture and annotations. Make video the default, and screenshots the supplement.

### 3. Always Include "What I Expected"

This is the most commonly skipped section, and it's one of the most important. "The dropdown doesn't work" only tells the developer what's broken. "The dropdown should show a list of all team members, sorted alphabetically" tells them what "working" looks like.

This is especially critical when the reporter is from a different team — the developer may genuinely not know the intended behavior.

### 4. Tag With Severity, Not Just Priority

As we covered above, severity and priority are different. Establish severity definitions for your team (use the matrix above as a starting point) and require a severity tag on every bug ticket. Let the product manager or tech lead set priority during triage.

### 5. Reproduce Before You Report

Before filing a ticket, try to reproduce the bug at least once more. If you can't reproduce it, say so — "Reproduced 1 out of 3 attempts" is useful information. If it's consistently reproducible, say that too. This single data point saves developers significant time.

### 6. One Bug Per Ticket

Resist the temptation to bundle related bugs into a single ticket. "The settings page has three issues" becomes a tracking nightmare — which issue is fixed? Which is still open? Can you close the ticket when two out of three are resolved?

One bug, one ticket. Always. It's easier to link related tickets than to untangle a combined one.

### 7. Include the Negative Test

When you find a bug, note what does work. "The save button fails when the description contains emoji, but works with plain text and special characters like &, <, >." This narrows the search space for the developer and often points directly to the root cause.

## Frequently Asked Questions

### What should a bug report include at a minimum?

At an absolute minimum, every bug report needs five things: a descriptive title, steps to reproduce, expected behavior, actual behavior, and environment information (browser, OS, app version). These five fields give a developer enough to start investigating. Screenshots or video, severity, and console errors are strongly recommended additions that make the report significantly more useful.

### What is the difference between bug severity and priority?

Severity measures the technical impact of a bug — how badly it affects the system and its users. Priority measures business urgency — how soon it should be fixed relative to other work. A critical-severity bug in a rarely used feature might be low priority. A low-severity typo on a high-traffic landing page might be high priority because it impacts conversions. Keeping them separate lets technical and product teams make better decisions during triage.

### How do I write a bug report when I can't reproduce the issue?

File the report with as much context as you can: what you were doing when it happened, the exact time (for log correlation), your environment details, and any error messages you saw. Note explicitly that you couldn't reproduce it and how many times you tried (e.g., "Occurred once, failed to reproduce in 5 subsequent attempts"). If you have a screen recording from the original occurrence, that's invaluable. Intermittent bugs are real bugs — they just need more context to track down.

## Wrapping Up

A bug report template won't fix a broken culture, but it will raise the floor. When every team member has a clear structure to follow, the average quality of bug reports goes up — and with it, the speed of fixes, the accuracy of estimates, and the sanity of your engineering team.

Start with the universal Markdown template above. Customize it for your team's specific needs. Enforce the five required fields. And if you find that templates alone aren't enough — that the manual effort is still a bottleneck — consider tools that automate the capture and generation process entirely.

The best bug report is the one that gets written. Make it easy, make it consistent, and the results will follow.