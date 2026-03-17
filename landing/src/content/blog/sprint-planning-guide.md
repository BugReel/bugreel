---
title: "Sprint Planning: Capacity, Velocity, and Commitment Guide"
description: "Master sprint planning with this practical guide. Learn to calculate capacity, use velocity data, and make realistic commitments."
date: 2026-03-09
author: "BugReel Team"
image: "/og-image.png"
tags: ["sprint-planning", "scrum", "velocity", "agile"]
---

Sprint planning is the most consequential meeting in Scrum. Every two weeks (or however long your sprints are), the entire development team sits down and answers one deceptively simple question: "What can we deliver in the next sprint?"

Get this right, and the sprint flows smoothly. Stakeholders get predictable delivery. Developers work at a sustainable pace. The team builds trust with the business by consistently delivering what they promised.

Get it wrong, and everything downstream suffers. Overcommit, and the team spends two weeks in a death march, cuts corners, and still doesn't finish everything — eroding trust and morale. Undercommit, and the team finishes early with idle capacity — wasting organizational resources and raising questions about whether the team is sandbagging.

The reason most teams struggle with sprint planning isn't lack of effort or skill. It's that they plan based on feelings instead of data. "This feels like a two-sprint feature" is not a plan. "Our average velocity is 42 points, we have 85% capacity this sprint due to PTO, and this backlog has been refined to include clear acceptance criteria" is a plan.

This guide gives you the data-driven approach. You'll learn how to calculate capacity, how to use (and not abuse) velocity data, how to make realistic commitments, how to handle risk and carry-over, and how to avoid the most common planning mistakes.

## What Happens in Sprint Planning

Sprint planning is a time-boxed meeting at the start of each sprint. The Scrum Guide says it should last a maximum of 8 hours for a month-long sprint, which means 2-4 hours for a typical two-week sprint. In practice, a well-prepared team can complete planning in 1-2 hours.

The meeting has two parts:

**Part 1: What can be done this sprint?**

The Product Owner presents the highest-priority items from the Product Backlog. The development team discusses each item, asks clarifying questions, and determines whether they understand it well enough to commit to it. Items that aren't well-defined get sent back for further refinement.

The team then selects which items they believe they can complete in the sprint, based on their capacity and historical velocity. The result is the Sprint Backlog — the set of items the team commits to delivering.

**Part 2: How will the work get done?**

The development team breaks each Sprint Backlog item into tasks, discusses implementation approaches, identifies dependencies, and distributes work. This is a technical discussion — the Product Owner typically doesn't need to participate beyond answering questions.

The output of sprint planning is:

- A **Sprint Goal** — a single sentence describing what the sprint aims to achieve
- A **Sprint Backlog** — the set of Product Backlog items selected for the sprint, plus the tasks needed to deliver them
- A shared understanding of **how** the team will approach the work

## Understanding Capacity

Capacity is the total amount of work your team can do in a sprint. It's not a constant — it changes every sprint based on team availability, and failing to account for this is one of the top reasons teams overcommit.

### How to Calculate Team Capacity

**Step 1: Count available person-days.**

For each team member, calculate how many days they'll be available in the sprint.

Example for a 10-day sprint (two weeks) with a 5-person team:

| Team Member | Sprint Days | PTO | Meetings/Ceremonies | Other Commitments | Available Days |
|---|---|---|---|---|---|
| Alice | 10 | 0 | 1 | 0 | 9 |
| Bob | 10 | 2 | 1 | 0 | 7 |
| Carol | 10 | 0 | 1 | 1 (conference) | 8 |
| Dave | 10 | 0 | 1 | 0 | 9 |
| Eve | 10 | 5 | 0.5 | 0 | 4.5 |

**Total available days: 37.5** (out of a theoretical 50)

**Step 2: Apply a focus factor.**

Not all "available" time is spent on sprint work. Developers also handle Slack questions, help with production issues, attend ad-hoc meetings, review pull requests from other teams, and do the countless small tasks that don't appear on the sprint board.

The focus factor represents the percentage of available time actually spent on sprint backlog items. For most teams, this is between 60% and 80%.

**Effective capacity: 37.5 days x 0.7 (70% focus factor) = 26.25 effective days**

**Step 3: Convert to your estimation unit.**

If your team estimates in story points, use velocity (not capacity in days) as your primary planning input, and use the capacity calculation as a sanity check and adjustment factor.

If your team estimates in hours, multiply effective days by productive hours per day (typically 5-6, not 8):

**Capacity in hours: 26.25 days x 6 hours/day = 157.5 hours**

### Common Capacity Mistakes

**Assuming 100% availability.** Nobody works 100% of their scheduled time on sprint stories. Even in the most focused environments, meetings, code reviews, production support, and communication overhead consume 20-40% of the day.

**Ignoring PTO and holidays.** Check the calendar before sprint planning. A sprint that spans a holiday week has significantly less capacity than a normal sprint.

**Not accounting for on-call rotations.** If a team member is on-call for the first week of the sprint, their capacity for sprint work is significantly reduced. Some teams count on-call members at 50% capacity; others exclude them entirely.

**Treating all team members as interchangeable.** If the sprint requires specialized skills (database migrations, iOS-specific work, design), make sure the team members with those skills have available capacity. Total team capacity doesn't help if the bottleneck is one person.

## Understanding Velocity

Velocity is the amount of work a team completes in a sprint, typically measured in story points. It's a historical measurement, not a target — it tells you what the team has actually done, which is the best predictor of what they can do next.

### How to Calculate Velocity

**Current velocity** is the number of story points completed (fully done, meeting the [Definition of Done](/blog/definition-of-done-examples/)) in the most recent sprint.

**Average velocity** is the average over the last 3-5 sprints. This smooths out outliers caused by sprint-specific factors (sick days, production incidents, unusually complex stories).

Example:

| Sprint | Points Completed |
|---|---|
| Sprint 18 | 38 |
| Sprint 19 | 45 |
| Sprint 20 | 32 |
| Sprint 21 | 44 |
| Sprint 22 | 41 |
| **Average** | **40** |

**Average velocity: 40 points/sprint.**

This is your primary planning input. When selecting items for the next sprint, aim for approximately 40 points of work (adjusted for capacity differences, as described below).

### Adjusting Velocity for Capacity Changes

If the upcoming sprint has different capacity than your historical average, adjust accordingly.

**Example:** Your average velocity is 40 points with a typical team capacity of 45 effective days. Next sprint, Eve is on vacation for the full two weeks, reducing capacity to 36 effective days.

**Adjusted velocity: 40 x (36 / 45) = 32 points**

This simple ratio adjustment is far more reliable than the team saying "we'll just work harder to make up for Eve being gone." Teams don't work harder to make up for reduced capacity — they either overcommit and burn out or quietly drop stories at the end of the sprint.

### What Velocity Is NOT

**It's not a productivity metric.** Velocity measures throughput in arbitrary units (story points) that only have meaning within a single team. Comparing velocity across teams is meaningless and harmful. A team with velocity 80 isn't "twice as productive" as a team with velocity 40 — they just estimate differently.

**It's not a target to maximize.** If management treats velocity as a KPI and pressures teams to increase it, teams will simply inflate their estimates. A 5-point story becomes an 8-point story, velocity "increases," and nothing actually changed except the numbers.

**It's not accurate for new teams.** Velocity requires a stable team working with a consistent estimation approach. A new team, or a team that just changed its estimation scale, needs 3-5 sprints before their velocity data becomes reliable.

**It's not a commitment.** "Our average velocity is 40" doesn't mean "we promise to deliver 40 points." It means "historically, we've completed about 40 points per sprint, so planning for approximately that much is reasonable."

## Making Realistic Commitments

The sprint commitment (or forecast, as some teams prefer to call it) is the set of items the team believes they can complete within the sprint. Here's how to make that commitment realistic.

### The Commitment Process

**Step 1: Know your capacity and adjusted velocity.** Before the meeting, calculate the team's available capacity for the upcoming sprint and adjust the historical velocity accordingly. This is your "budget."

**Step 2: Start from the top of the backlog.** The Product Owner should have a refined, prioritized backlog. Begin with the highest-priority item and work down.

**Step 3: For each item, ask three questions:**
- Do we understand the acceptance criteria well enough to start work? (If no, defer it back to refinement)
- Can we finish this within the sprint alongside everything else we've already selected? (Track running total against your velocity budget)
- Are there dependencies or blockers that could prevent completion? (If yes, identify and resolve them or select a different item)

**Step 4: Stop when you hit your velocity budget.** This is the hardest discipline in sprint planning. The natural tendency is to squeeze in "one more small story" that pushes the total to 10-15% above velocity. Resist this. Consistent overcommitment is the primary cause of sprint failure.

**Step 5: Add a sprint goal.** The sprint goal is a one-sentence description of the sprint's objective that gives the team coherence and focus. "Complete the user notification system and resolve the three highest-priority bugs" is a good sprint goal. "Finish stories 234, 237, 241, 245, 249, 252" is not — it's just a list.

### The 85% Rule

Many experienced Scrum teams plan to approximately 85% of their average velocity. If average velocity is 40 points, they select 34 points of committed work.

The remaining 15% serves as a buffer for:
- Stories that turn out to be more complex than estimated
- Production incidents that require attention mid-sprint
- Pull request review cycles that take longer than expected
- Sick days or unexpected absences

If the team finishes the committed stories early, they pull the next item from the Product Backlog. This is far better than overcommitting: the team builds a track record of consistently meeting commitments, stakeholders learn to trust the forecasts, and the occasional early finish feels like a win rather than the norm of scrambling to finish everything.

## Handling Risk and Uncertainty

Every sprint contains uncertainty. The team's job isn't to eliminate uncertainty — it's to acknowledge it and plan accordingly.

### Spikes for Uncertain Stories

A spike is a time-boxed investigation task designed to reduce uncertainty. If a story has significant unknowns ("We need to integrate with the Acme API, but we've never used it and the documentation is unclear"), create a spike for the current sprint and defer the actual implementation to the next sprint.

**Good spike:** "Spend up to 4 hours investigating the Acme API authentication flow. Deliverable: a brief write-up of the integration approach and a revised estimate for the implementation story."

**Bad spike:** "Figure out the Acme integration." (No time box, no clear deliverable, no definition of done)

Spikes let you turn unknown unknowns into known quantities. The 4-hour spike this sprint might save you from a 3-day rabbit hole next sprint.

### Story Splitting for Large Items

Stories larger than about one-third of the team's sprint velocity are risky. If your velocity is 40 points, a 20-point story has a high chance of not being completed within the sprint — it's too large for the team to fully understand, estimate accurately, or course-correct if something goes wrong.

Split large stories into smaller, independently deliverable pieces. The test for a good split: each piece delivers user-visible value on its own. "Backend API" and "Frontend UI" is a technical split (neither piece is useful alone). "User can create a notification" and "User can configure notification preferences" is a functional split (each piece is independently useful).

### Dependency Management

Dependencies between stories, between team members, or on external teams are the silent killers of sprint commitments.

**Internal dependencies:** If Story B can't start until Story A is done, and both are in the same sprint, the team needs to plan the execution order. Assign Story A to the first few days and Story B to the latter half. If Story A slips, Story B is at risk.

**External dependencies:** If the sprint requires input from another team (a design mockup, an API endpoint, a security review), verify that the dependency will be met before committing the story. "The design team said they'd have it by Wednesday" is not verified. "The design team has committed to delivering the mockup by Tuesday, and here's the Slack thread confirming it" is verified.

**Technical dependencies:** If a story requires a database migration, a library upgrade, or an infrastructure change, factor those into the effort estimate. "The feature itself is 3 points, but the database migration adds 2 points of risk" should be reflected in the total.

## Managing Carry-Over

Carry-over is work that was committed in one sprint but not completed, spilling into the next sprint. Some amount of carry-over is normal. Persistent, significant carry-over is a problem.

### Acceptable Carry-Over

One incomplete story per sprint, especially if it's nearly done and the delay was caused by an external factor (waiting for code review, dependency from another team, unexpected complexity in the last 10%). The story rolls into the next sprint, the team adjusts their commitment to account for it, and it gets finished in the first few days.

### Problematic Carry-Over

Three or more stories carrying over consistently, or the same story carrying over for multiple sprints. This indicates one or more of:

- **Overcommitment:** The team is consistently selecting more work than their velocity supports. Solution: commit to 80-85% of velocity until the carry-over stabilizes.
- **Stories too large:** Large stories are more likely to carry over because they're harder to estimate and have more failure modes. Solution: enforce a maximum story size (e.g., no story larger than 8 points for a team with velocity 40).
- **Scope creep during sprint:** Stories grow mid-sprint as new requirements emerge. Solution: enforce scope discipline — new requirements go to the backlog, not into the current sprint's stories.
- **Blocked work:** Stories get stuck waiting for dependencies, reviews, or decisions. Solution: identify blockers in daily stand-ups and resolve them immediately.
- **Unclear [Definition of Done](/blog/definition-of-done-examples/):** The team disagrees on what "done" means, so stories linger in a "mostly done" state. Solution: establish and enforce a clear DoD.

### How to Handle Carry-Over in Planning

When a story carries over into the next sprint:

1. Re-estimate the remaining work. Don't use the original estimate — estimate what's actually left. A story originally estimated at 8 points that's 75% done might have 3 points remaining.
2. Subtract the remaining work from the team's velocity budget for the new sprint. If velocity is 40 and carry-over work is 3 points, select 37 points of new work.
3. Prioritize the carry-over story. It should be the first thing worked on in the new sprint, not the last. Carrying over a story for a third sprint is a red flag.
4. In the retrospective, discuss why the carry-over happened and what can be done to prevent it.

## Common Sprint Planning Mistakes

### Mistake 1: Overcommitting

This is the most damaging mistake and it's caused by optimism bias — the team believes this sprint will be different. "We had sick days last sprint, but this sprint should be normal." "That story was unusually complex — we won't have that problem again." "We're really motivated this time."

Reality: every sprint has disruptions. Sick days, production incidents, unexpected complexity, and scope creep are not anomalies — they're the norm. Plan for the sprint you'll actually have, not the sprint you wish you'd have.

**Fix:** Use velocity data, not feelings. If your average velocity over 5 sprints is 40, plan for 34-40 points. Not 50.

### Mistake 2: Planning Without Refinement

Sprint planning is not the time to discover that a story is ambiguous, has unresolved technical questions, or depends on an API that doesn't exist yet. Stories should enter sprint planning already refined: clear acceptance criteria, agreed-upon approach, understood dependencies, and a reasonable size estimate.

If more than 20% of sprint planning time is spent clarifying stories, your refinement process is broken.

**Fix:** Hold backlog refinement sessions mid-sprint (many teams do this on Wednesdays). Only items that have been through refinement are eligible for sprint planning.

### Mistake 3: Ignoring Velocity

"I know our velocity is 40, but I think we can do 55 this sprint because the stories are simpler." This is the planning equivalent of "I know the speed limit is 65, but my car can go faster."

Velocity is a measured ceiling, not a floor to exceed. Occasionally a team will exceed their average velocity, but planning for it is setting the team up for failure.

**Fix:** Treat velocity as a budget, not a guideline. You can spend less than the budget. You cannot spend more.

### Mistake 4: Not Accounting for Non-Sprint Work

Bug fixes, production support, code reviews for other teams, mentoring, documentation, meetings — all of these consume developer time but don't appear on the sprint board. If your team spends 25% of their time on non-sprint work (which is typical), but your sprint plan assumes 100% of their time, you're overcommitting by 25%.

**Fix:** Track non-sprint work for 2-3 sprints. Use the data to calculate your focus factor and apply it to capacity planning.

### Mistake 5: Treating Estimates as Promises

A story estimated at 5 points is not a promise that it will take exactly 5 points of effort. It's an approximation based on incomplete information. When a 5-point story turns out to require 8 points of effort, the correct response is to adjust the sprint (drop a lower-priority story to compensate), not to force the developer to "find a way to make it fit."

**Fix:** Build buffer into your sprint plan (the 85% rule). When estimates are wrong, adjust scope, not effort.

### Mistake 6: Skipping the Sprint Goal

Without a sprint goal, the sprint is just a list of unrelated stories. The team has no shared sense of purpose, no way to make trade-off decisions during the sprint, and no coherent narrative for stakeholders.

When an unexpected issue arises mid-sprint, the sprint goal helps the team decide what to do. "Does handling this production bug serve the sprint goal? No — defer it. Yes — reprioritize."

**Fix:** Write a sprint goal before selecting stories. The goal guides which stories are selected, not the other way around.

## Sprint Planning Templates

### Basic Sprint Planning Agenda

1. **Sprint goal discussion** (10 min) — What is this sprint trying to achieve?
2. **Capacity review** (5 min) — Who's available? Any PTO, on-call, or reduced availability?
3. **Velocity check** (5 min) — What's our average velocity? Any adjustment needed for capacity changes?
4. **Backlog walkthrough** (30-60 min) — Review each candidate story: acceptance criteria, estimate, dependencies
5. **Commitment** (10 min) — Confirm the selected stories, verify total points against velocity budget
6. **Task breakdown** (20-30 min) — Break stories into tasks, identify who's working on what

### Sprint Planning Inputs Checklist

Before the meeting starts, verify:
- Backlog is refined — top items have clear acceptance criteria and estimates
- Capacity is calculated — PTO, holidays, on-call factored in
- Velocity data is available — last 3-5 sprints
- Carry-over items are re-estimated — remaining work, not original estimate
- Dependencies are identified — external teams, APIs, design assets
- [Bug triage](/blog/bug-triage-process-guide/) is complete — bugs are [classified by severity and priority](/blog/severity-vs-priority-guide/) and prioritized against features

If you want a structured approach to sprint planning that handles capacity calculation and velocity tracking automatically, our [sprint planner tool](/tools/sprint-planner/) walks you through the entire process step by step.

## Frequently Asked Questions

### Should we estimate in story points or hours?

Story points are generally better for sprint planning because they measure relative complexity rather than absolute time. A story that's "twice as complex" as a reference story gets twice the points — regardless of who works on it or how long it actually takes. This decouples estimation from individual developer speed, which makes team-level planning more reliable. Hours feel more intuitive but introduce problems: estimates vary wildly by developer skill level, they create implicit commitments ("you said 8 hours, why did it take 16?"), and they discourage discussion about complexity in favor of stopwatch-style estimation. That said, some teams — particularly small teams, new teams, or teams doing mostly operational work — find hours more practical. The best estimation unit is the one your team uses consistently and honestly. If you've been using story points for 6 months and they're not working, try hours. If you've been using hours and estimates are always wrong, try story points. The unit matters less than the consistency.

### How do you handle urgent bugs that come in mid-sprint?

This depends on the bug's [severity and priority](/blog/severity-vs-priority-guide/). For P1 bugs (production down, security breach, revenue loss), the team drops whatever they're working on and addresses the bug immediately. This will reduce sprint output, and that's acceptable — adjust expectations rather than pretending the sprint wasn't disrupted. For P2 bugs (important but not emergency), the team should make a trade-off: pull the bug into the sprint and remove an equivalent amount of planned work. Don't just add it on top of the existing commitment. For P3 and P4 bugs, add them to the backlog for the next sprint's planning. They don't justify disrupting the current sprint. The key principle is that the total amount of work in the sprint should remain roughly constant. Adding work without removing work is how sprints become death marches. Track mid-sprint additions and their impact on velocity — if you're consistently adding 10 points of unplanned work per sprint, that's a capacity input that should reduce your planned commitment by 10 points.

### What if the team consistently delivers less than their velocity suggests?

First, verify that velocity is being calculated correctly. Velocity should only count stories that are fully done (meeting the Definition of Done), not stories that are "almost done" or "in QA." If partially complete stories are being counted, your velocity is inflated and your plans are based on a lie. Second, check for hidden work. Is the team spending time on production support, meetings, or cross-team reviews that aren't being tracked? If so, your focus factor is too optimistic. Third, examine story quality. Are stories entering the sprint with unclear acceptance criteria, leading to mid-sprint scope changes? Are estimates consistently too low because the team doesn't account for testing, code review, and deployment? Finally, look for systemic blockers: slow CI/CD pipelines, frequent environment issues, or key-person dependencies that create bottlenecks. The solution is almost never "work harder" — it's almost always "plan more accurately" or "remove impediments." Reduce the planned commitment to match actual output, then address the root causes one by one.