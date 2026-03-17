---
title: "Definition of Done: Complete Guide with Examples for Every Team"
description: "What is Definition of Done in Scrum? See real DoD examples for web, mobile, API, and data teams. Plus a free interactive generator."
date: 2026-03-13
author: "BugReel Team"
image: "/og-image.png"
tags: ["definition-of-done", "scrum", "agile", "checklist"]
---

A developer marks a ticket as "Done." The product manager opens the feature and finds no loading state, no error handling, and no documentation. The developer shrugs: "The code works on my machine." The product manager sighs: "That's not what Done means." Both are right — and both are wrong — because the team never agreed on what "Done" actually means.

This scenario plays out in thousands of teams every week. The Definition of Done is one of the most important yet most neglected agreements in software development. When it's missing or vague, every sprint ends with the same frustrating ritual: half-finished work, rework in the next sprint, and a growing pile of invisible technical debt that nobody accounts for.

This guide gives you everything you need to create, implement, and maintain a Definition of Done that actually works. You'll get clear explanations of what DoD is (and isn't), ready-to-use examples for four different team types, common mistakes to avoid, and a practical process for building your own. By the end, your team will have a shared, enforceable standard for what "Done" really means.

## What Is a Definition of Done?

The Definition of Done (DoD) is a shared checklist of conditions that every product backlog item must satisfy before it can be considered complete. It's not aspirational — it's a binary gate. Either every item on the checklist is satisfied, or the work isn't done.

The Scrum Guide defines it as "a formal description of the state of the Increment when it meets the quality measures required for the product." In practice, it's simpler than that: it's the team's agreement about the minimum quality bar that all work must clear.

A few critical properties of a good DoD:

**It's universal.** The DoD applies to every piece of work, not just specific tickets. You don't negotiate it per story. If "unit tests pass" is on your DoD, it applies to the login page refactor and the one-line copy change alike.

**It's binary.** Every item on the checklist is either satisfied or not. There's no "mostly done" or "90% complete." Ambiguous checklist items like "code is clean" are useless because they invite interpretation. "Linter passes with zero warnings" is binary.

**It's owned by the team.** The DoD isn't imposed by management or the Scrum Master. The development team creates it, maintains it, and enforces it. When the team gets more mature, the DoD gets stricter.

**It evolves.** A new team might have a simple DoD with five items. A mature team might have twenty. The DoD should be reviewed every few sprints and tightened as the team's practices improve. It should never get looser — that's a regression, not an evolution.

## Definition of Done vs Acceptance Criteria

This is the most common point of confusion, so let's settle it clearly.

**Acceptance Criteria** are specific to a single user story. They describe the functional requirements that this particular feature must meet. "When the user clicks 'Export,' a CSV file downloads containing all filtered records" is an acceptance criterion. It applies only to the export feature.

**Definition of Done** is universal across all stories. It describes the quality and process requirements that every piece of work must meet. "All new code has unit tests with >80% coverage" is a DoD item. It applies to the export feature, the login page, and every other ticket.

Think of it this way:

- **Acceptance criteria** answer: "Does this feature do what we said it would do?"
- **Definition of Done** answers: "Is this feature ready for production?"

A story can pass all its acceptance criteria — the export button works, the CSV contains the right data, edge cases are handled — but still not be "Done" because the code hasn't been reviewed, the deployment pipeline hasn't been updated, or the feature isn't behind a feature flag.

Both are necessary. Acceptance criteria without a DoD means features work but the codebase degrades. A DoD without acceptance criteria means the code is pristine but the feature doesn't meet user needs.

### Quick Comparison

| | Acceptance Criteria | Definition of Done |
|---|---|---|
| **Scope** | One user story | All user stories |
| **Who writes it** | Product Owner / PM | Development team |
| **What it covers** | Functional behavior | Quality and process |
| **When it changes** | Every story is different | Changes infrequently |
| **Example** | "Search returns results within 2 seconds" | "Performance tested under expected load" |

## DoD Examples for Web Development Teams

Web teams deal with cross-browser compatibility, responsive layouts, accessibility standards, and fast-moving frontend frameworks. Here's a comprehensive DoD tailored for a web development team.

### Code Quality
- Code has been peer-reviewed and approved by at least one other developer
- All new and modified code passes the project linter with zero errors and zero warnings
- No `console.log`, debug statements, or `TODO` comments left in production code
- Functions and components follow the project's naming conventions
- No hardcoded values — configuration lives in environment variables or config files

### Testing
- Unit tests written for all new business logic with minimum 80% line coverage
- Integration tests pass for all affected user workflows
- Cross-browser testing completed on Chrome, Firefox, Safari, and Edge (latest two versions)
- Responsive layout verified on mobile (375px), tablet (768px), and desktop (1440px)
- Accessibility audit passes with zero critical or serious axe-core violations

### Deployment
- Feature is deployable to production via the standard CI/CD pipeline
- No new build warnings introduced
- Environment variables documented and added to `.env.example`
- Database migrations (if any) are reversible
- Feature flag configured for gradual rollout (if applicable)

### Documentation
- README updated if setup steps changed
- API documentation updated (if new endpoints were added)
- Inline code comments added for non-obvious business logic

### Verification
- Product Owner has reviewed the feature against acceptance criteria
- [Bug reporting](/blog/how-to-write-bug-report/) process validated — errors show meaningful messages, not stack traces
- No new errors in the browser console during normal usage
- Loading states and empty states are implemented

## DoD Examples for Mobile Development Teams

Mobile teams face platform-specific challenges: app store review processes, device fragmentation, offline behavior, and strict memory/battery constraints.

### Code Quality
- Code has been peer-reviewed and approved by at least one other developer
- All new code follows platform conventions (Swift style guide for iOS, Kotlin style guide for Android)
- No force-unwraps (iOS) or unchecked casts (Android) without documented justification
- Static analysis passes with zero new warnings (SwiftLint / detekt)
- Localization strings extracted — no hardcoded user-facing text

### Testing
- Unit tests written for all new ViewModels / Presenters / Interactors
- UI tests cover the primary happy path of the new feature
- Tested on minimum supported OS version (iOS 16+, Android 10+)
- Tested on at least two screen sizes per platform (phone and tablet if applicable)
- Offline behavior verified — the app doesn't crash without network connectivity
- Memory profiling completed — no new memory leaks detected in Instruments / Android Profiler

### Deployment
- Build compiles without warnings on both Debug and Release configurations
- App version and build number incremented according to the versioning scheme
- No new permissions requested without product approval and documentation
- ProGuard / obfuscation rules updated if new classes require keep rules (Android)
- App size impact measured — increase documented if greater than 1MB

### Documentation
- Release notes drafted for the change
- Internal wiki updated with feature architecture overview (for complex features)
- Analytics events documented and verified in staging

### Verification
- QA has tested the feature on physical devices (not just simulators)
- Push notifications tested if applicable (staging environment)
- Deep links tested if applicable
- Feature works correctly with accessibility features enabled (VoiceOver / TalkBack)

## DoD Examples for API / Backend Teams

Backend teams focus on reliability, security, performance, and data integrity. A backend DoD must account for the fact that APIs serve multiple consumers and failures cascade.

### Code Quality
- Code has been peer-reviewed and approved by at least one other developer
- All new code passes the project linter and static analysis with zero new issues
- Database queries reviewed for N+1 problems and missing indexes
- No raw SQL in application code — use the ORM or parameterized queries
- Secrets and credentials are never hardcoded — all pulled from environment or secret manager

### Testing
- Unit tests written for all new service/business logic with minimum 80% coverage
- Integration tests cover all new API endpoints (happy path + primary error paths)
- Contract tests verify request/response schemas match the API documentation
- Load testing completed for endpoints expected to handle >100 requests/second
- Edge cases tested: empty inputs, maximum-length inputs, Unicode, special characters

### Security
- Authentication and authorization verified — endpoints reject unauthenticated and unauthorized requests
- Input validation implemented on all new endpoints (type checking, length limits, allowed values)
- Rate limiting configured for public-facing endpoints
- SQL injection, XSS, and CSRF protections verified
- Sensitive data (passwords, tokens, PII) never logged or returned in API responses

### Deployment
- Database migration tested on a staging environment with production-like data volume
- Migration is reversible (down migration exists and has been tested)
- Monitoring and alerting configured — new endpoints have health checks and error rate alarms
- API documentation (OpenAPI/Swagger) updated with new endpoints, parameters, and response schemas
- Backward compatibility verified — existing API consumers are not broken

### Documentation
- Changelog updated with the new API version entry
- Internal runbook updated if operational procedures changed
- Data model changes documented in the schema reference

## DoD Examples for Data / Analytics Teams

Data teams work with pipelines, transformations, and models where correctness is paramount and bugs can be invisible for weeks.

### Code Quality
- Code has been peer-reviewed by at least one other data engineer or analyst
- SQL and transformation logic follows the team's style guide
- No hardcoded date ranges, IDs, or filter values — all parameterized
- Data pipeline uses idempotent operations — re-running doesn't create duplicates

### Testing
- Unit tests written for all transformation functions
- Data quality checks implemented: null checks, type validation, row count assertions, uniqueness constraints
- Pipeline tested with edge cases: empty input, single row, maximum expected volume
- Results validated against a known-good source (reconciliation) for at least one historical period
- Schema changes tested against all downstream consumers

### Data Quality
- No orphaned records created in target tables
- Referential integrity verified across joined datasets
- Output data profiled: distributions, min/max values, and null rates are within expected ranges
- PII handling verified — sensitive fields masked, encrypted, or excluded per policy

### Deployment
- Pipeline runs successfully end-to-end in the staging environment
- Scheduling configured (Airflow DAG, cron, etc.) with appropriate retry and timeout settings
- Monitoring configured — alerts on pipeline failure, data quality threshold breaches, and SLA misses
- Backfill plan documented if the pipeline needs to process historical data

### Documentation
- Data catalog updated with new tables, columns, and their business definitions
- Lineage documentation updated — source-to-target mapping is current
- Dashboard or report consumers notified of schema or metric changes

## Common DoD Mistakes

### 1. Making It Too Vague

A DoD item like "code is tested" is meaningless. Tested how? Unit tests? Integration tests? Manual QA? With what coverage target? Vague items become rubber stamps — everyone checks them off without actually doing the work. Every DoD item should be specific enough that two different people would agree on whether it's satisfied.

**Bad:** "Code is reviewed"
**Good:** "Code has been reviewed and approved by at least one developer who is not the author, with all review comments resolved or explicitly deferred with a tracked ticket"

### 2. Making It Aspirational Instead of Enforceable

If your DoD says "100% code coverage" but your codebase is at 40%, you have two options: enforce it (and watch your velocity drop to near zero) or ignore it (and make the entire DoD meaningless). A DoD must reflect what the team can actually deliver today. Set realistic minimums and raise them over time.

### 3. Skipping It for "Small" Changes

"It's just a one-line fix, we don't need a code review." This is how bugs ship. The DoD applies to everything or it applies to nothing. The moment you start making exceptions, the DoD becomes optional, and optional standards are no standards at all.

### 4. Never Updating It

A team that has used the same DoD for two years is either stagnating or ignoring it. The DoD should evolve as the team improves. If you added accessibility testing to your workflow six months ago, it should be in your DoD now. Review the DoD in retrospectives at least once a quarter.

### 5. Confusing DoD with a Sprint Checklist

The DoD is about quality standards, not process steps. "Ticket moved to Done column" is a process step, not a quality standard. "Acceptance criteria verified by Product Owner" is a quality standard. Keep process tracking in your workflow tool and quality standards in your DoD.

### 6. Making It So Long Nobody Reads It

If your DoD has 40 items, nobody is checking all of them. Prioritize. A DoD with 8-12 well-chosen items that the team actually uses beats a comprehensive 30-item list that everyone ignores. Start small, enforce ruthlessly, and expand gradually.

## How to Create Your Own Definition of Done

### Step 1: Audit Your Recent Failures

Look at the last 10 bugs that made it to production, the last 5 stories that required rework, and the last 3 sprint reviews where the Product Owner rejected something. For each, ask: "What check, if it had been on our Definition of Done, would have caught this?"

This gives you a list grounded in real pain, not theoretical best practices. A DoD driven by actual failures is far more likely to be taken seriously than one copied from a blog post.

### Step 2: Draft the Initial List

Take the checks from Step 1 and combine them with the absolute basics your team should already be doing (code review, tests pass, no build warnings). Keep the total to 8-12 items. For each item, make sure it's:

- **Specific** — no ambiguity about what "done" means
- **Measurable** — can be verified with a binary yes/no
- **Achievable** — the team can actually do this for every story today
- **Relevant** — it prevents a real problem, not a theoretical one

### Step 3: Get Team Buy-In

Present the draft to the entire development team. This is not a top-down mandate. Discuss each item. Remove anything the team thinks is unreasonable or unachievable right now. Add anything the team feels is missing. The goal is unanimous agreement — if even one person thinks an item is unreasonable, either revise it or remove it.

### Step 4: Make It Visible

Print it on the wall. Pin it in Slack. Add it to your pull request template. Make it the first thing people see when they move a ticket to "Ready for Review." A DoD that lives in a Confluence page nobody visits is a DoD that doesn't exist.

### Step 5: Enforce It

This is where most teams fail. The DoD is only as strong as the team's willingness to enforce it. When a developer moves a ticket to Done without satisfying the DoD, the Scrum Master (or any team member) should move it back. No exceptions, no "just this once." The first time you let a violation slide, you've told the team the DoD is optional.

### Step 6: Review and Evolve

Every quarter (or every major retrospective), review the DoD. Questions to ask:

- Are we satisfying every item on every story? If so, can we raise the bar?
- Are we consistently failing one item? Is it unrealistic, or do we need training?
- Did any recent production issues reveal a gap in our DoD?
- Has our technology or process changed in a way that makes items obsolete?

If you want to skip the blank-page problem entirely, our interactive [Definition of Done generator](/tools/definition-of-done/) walks you through a series of questions about your team type, tech stack, and maturity level, then produces a tailored checklist you can adopt immediately.

## How DoD Connects to Other Quality Practices

The Definition of Done doesn't exist in isolation. It's one piece of a broader quality framework.

**Bug triage** benefits directly from a strong DoD. When [triaging bugs](/blog/bug-triage-process-guide/), one of the first questions should be: "Did this escape because a DoD item was skipped, or because our DoD has a gap?" This turns every production bug into a feedback signal for your DoD.

**Severity classification** becomes more consistent when the DoD ensures all bugs are reported with sufficient context. If your DoD includes "error states show meaningful messages with error codes," your [severity assessments](/blog/severity-vs-priority-guide/) will be based on real information rather than vague descriptions like "it doesn't work."

**Sprint planning** improves because the DoD makes the true cost of work visible. When "Done" means "code reviewed, tested, documented, and deployed to staging," the team accounts for that work in their estimates instead of pretending that "Done" means "code pushed to a branch."

## Frequently Asked Questions

### Can the Definition of Done be different for different teams in the same organization?

Yes, and it often should be. A mobile team and a backend API team have fundamentally different quality concerns. Platform-specific items (like "tested on physical devices" for mobile or "migration is reversible" for backend) don't make sense as organization-wide standards. However, some items should be universal across all teams: code review, automated tests pass, and no known security vulnerabilities. Many organizations use a layered approach — an organization-wide DoD with 4-5 universal items, plus a team-specific DoD that adds items relevant to that team's technology and domain. The organization-wide items are non-negotiable. The team-specific items are owned and evolved by each team independently.

### What do you do when the team consistently can't meet the DoD?

If the team is regularly unable to satisfy the DoD, something needs to change — but it's not always the DoD that should change. First, diagnose the root cause. If the team can't write unit tests because the codebase has no test infrastructure, that's a tooling problem — invest a sprint in setting up the test framework. If the team can't get code reviews because there's only one senior developer, that's a capacity problem — consider pair programming or asynchronous reviews. Only weaken the DoD if the item is genuinely unreasonable for your current context. And if you do relax an item, set a specific date to revisit it: "We're removing the 80% coverage requirement for the next two sprints while we build out our test infrastructure, then we'll reinstate it."

### Should the Definition of Done include non-functional requirements like performance and security?

Absolutely — non-functional requirements are often the most important items on a DoD because they're the easiest to skip under deadline pressure. Performance testing ("page loads in under 2 seconds on a 3G connection"), security review ("OWASP Top 10 verified for new endpoints"), and accessibility compliance ("WCAG 2.1 AA") are all legitimate DoD items. The key is to make them measurable and automated wherever possible. "Performance is acceptable" is not enforceable. "Lighthouse performance score is above 90" is enforceable. Start with the non-functional requirements that matter most to your users and your business, automate their verification in your CI/CD pipeline, and expand the list as your tooling matures.