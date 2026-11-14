import Mathlib

theorem ai4math_local_smoke_add_zero (n : Nat) : n + 0 = n := by
  simp

theorem ai4math_local_smoke_le_succ (n : Nat) : n <= n + 1 := by
  omega
