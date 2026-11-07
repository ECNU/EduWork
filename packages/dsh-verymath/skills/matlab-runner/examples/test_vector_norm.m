function tests = test_vector_norm
%TEST_VECTOR_NORM Function-based tests for simple vector lengths.
tests = functiontests(localfunctions);
end

function testNorm3_4(testCase)
verifyEqual(testCase, norm([3 4]), 5, 'AbsTol', 1e-12);
end

function testHypot5_12(testCase)
verifyEqual(testCase, hypot(5, 12), 13, 'AbsTol', 1e-12);
end
