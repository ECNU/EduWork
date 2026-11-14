# Quality Rubric

Score each dimension from 1 to 5.

## Dimensions

- `reusability`: Can this method be reused in other papers or problems?
- `clarity`: Are inputs, outputs, assumptions, and steps clear?
- `generality`: Is the method detached from paper-specific notation and claims?
- `verifiability`: Can a reviewer or test case check whether the skill worked?
- `agent_callability`: Can an agent decide when to call it from trigger cues?
- `mathematical_risk`: How likely is misuse due to missing assumptions? 1 is low risk, 5 is high risk.

## Total Score

```text
total_score =
0.25 * reusability
+ 0.20 * clarity
+ 0.20 * generality
+ 0.15 * verifiability
+ 0.15 * agent_callability
- 0.05 * mathematical_risk
```

Round to two decimals.

## Status

```text
total_score >= 4.0       accepted_candidate
3.0 <= total_score < 4.0  needs_review
total_score < 3.0         rejected
```

Use `needs_review` instead of `accepted_candidate` when the score is high but assumptions are ambiguous or the mathematical risk is 4 or 5.
