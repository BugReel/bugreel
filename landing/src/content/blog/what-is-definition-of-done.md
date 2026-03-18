---
title: "What Is Definition of Done (DoD) in Scrum?"
description: "Definition of Done is a shared checklist that determines when a Product Backlog item is complete. Learn how DoD works in Scrum."
date: 2026-03-03
author: "BugReel Team"
image: "/og-image.png"
tags: ["definition-of-done", "scrum", "agile"]
---

A developer says the feature is "done." The QA engineer opens it and finds no tests, no documentation, and a UI that doesn't match the design. A day of back-and-forth follows. The sprint review arrives and the feature isn't actually shippable.

This is the problem that Definition of Done solves.

## What Definition of Done Means

Definition of Done (DoD) is a shared, explicit checklist that every Product Backlog item must satisfy before it can be considered complete. It's not a suggestion or a guideline — in Scrum, it's a formal commitment by the Scrum Team that defines what "done" means for their specific context.

If a Product Backlog item does not meet the Definition of Done, it cannot be released or even presented at the Sprint Review. DoD is the team's quality bar — it prevents "done" from meaning different things to different people.

## Why It Matters

Without a DoD, "done" is subjective. The developer thinks done means "code written." The tester thinks done means "tested and verified." The product manager thinks done means "deployed and monitored." These mismatched expectations create friction, rework, and missed deadlines.

A shared Definition of Done eliminates that ambiguity. When every team member knows the exact criteria, several things improve.

**Predictability.** The team can estimate more accurately because "done" has a fixed scope. No hidden work gets discovered at the last minute.

**Quality.** A DoD that includes testing, code review, and documentation ensures these steps don't get skipped under deadline pressure.

**Trust.** Stakeholders learn that when the team says something is done, it genuinely is — not 80% done with a list of follow-up tasks.

**Velocity accuracy.** Story points only mean something if every completed story meets the same standard.

## What a Definition of Done Looks Like

A DoD is typically a checklist of 5 to 15 items. The exact items depend on your team, your product, and your organizational standards. Here's an example that works for many web application teams:

- Code is written and committed to the main branch
- All existing unit tests pass
- New code has unit test coverage
- Code has been peer-reviewed and approved
- No new linting errors or warnings
- Feature works in Chrome, Firefox, and Safari
- Feature is tested on mobile viewport (375px)
- Accessibility: no new axe-core violations
- API changes are documented
- Feature has been deployed to staging and verified
- Product owner has reviewed and accepted

Every item on this list is binary — either it's satisfied or it isn't. There's no room for "mostly done" or "we'll finish that later." That's by design. For more examples tailored to different team types and project sizes, see our [Definition of Done examples guide](/blog/definition-of-done-examples/).

## DoD vs. Acceptance Criteria

These two concepts are related but distinct.

**Acceptance criteria** are specific to a single user story. They describe the functional requirements — what this particular feature needs to do. "When the user clicks Export, a CSV file downloads containing all filtered records" is an acceptance criterion.

**Definition of Done** applies to every story. It describes the quality and process requirements that all work must meet. "Code is peer-reviewed" and "no new linting errors" apply regardless of what the feature does.

A story is complete when it meets both its acceptance criteria (does the right thing) and the Definition of Done (meets the team's quality bar).

## How to Create Your DoD

Start with what your team already does informally. Most teams have unwritten rules about code review, testing, and deployment. Writing them down is the first step.

**Gather the team.** DoD should be created collaboratively, not imposed. Every team member should have input.

**Start small.** Five to eight items is enough. A 30-item DoD looks thorough on paper but gets ignored in practice.

**Make it visible.** Pin it to the team board or embed it in your issue tracker template. Our [Definition of Done generator](/tools/definition-of-done/) can help you build and format a checklist tailored to your workflow.

**Review it regularly.** Add items when recurring quality issues reveal gaps. Remove items that no longer add value. The Sprint Retrospective is a natural place to revisit your DoD.

## The Payoff

A well-maintained Definition of Done is one of the highest-leverage practices in software development. It costs almost nothing to implement — it's just a checklist — but it prevents the most expensive category of waste: rework caused by misaligned expectations. When everyone agrees on what "done" means, work flows forward instead of bouncing back.
