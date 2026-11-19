import Mathlib

theorem target_theorem (n : Nat) : n + 0 = n := by
  sorry

theorem other_theorem (n : Nat) : 0 + n = n := by
  exact Nat.zero_add n
