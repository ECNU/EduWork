# Artifact Contract

Use these names when writing durable outputs. Markdown files are for humans;
JSON files are for resume and later adapters.

## Required Status Labels

- `background_map`
- `candidate_problem_menu`
- `candidate_conjecture`
- `stress_tested_conjecture`
- `proof_obligations_ready`
- `verification_ready`

## `problem_menu.json`

Each candidate record should include:

- `problem_id`
- `title`
- `plain_language_hook`
- `candidate_statement`
- `objects`
- `evidence_refs`
- `domain_tags`
- `interest_rationale`
- `proof_route_guess`
- `counterexample_risk`
- `source_needs`
- `next_action`
- `status`

## `conjecture_lattice.json`

Each lattice entry should include:

- `candidate_problem_id`
- `variant_id`
- `variant_type`
- `statement`
- `changed_from_base`
- `motivation`
- `toy_model_status`
- `risk_notes`
- `next_test`

## `proof_obligations.json`

Each obligation should include:

- `obligation_id`
- `candidate_problem_id`
- `claim`
- `depends_on`
- `known_support`
- `missing_argument`
- `counterexample_pressure`
- `status`
- `next_action`

## `work_orders.json`

Each work order should include:

- `work_order_id`
- `agent_role`
- `objective`
- `input_refs`
- `required_output`
- `ledger_patch_targets`
- `acceptance_criteria`
- `stop_conditions`
- `forbidden_claims`

## `research_state_packet.json`

The packet should include:

- `status_label`
- `seed`
- `background_map_ref`
- `problem_menu_ref`
- `conjecture_lattice_ref`
- `evidence_ledger_ref`
- `counterexample_pressure_ref`
- `proof_obligations_ref`
- `work_orders_ref`
- `decision_ledger`
- `blocked_items`
- `next_recommended_action`

Do not set `status_label` to `verification_ready` unless proof obligations are
explicit and unresolved counterexample pressure has been addressed or recorded.
