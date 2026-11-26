function report = matrix_report(A)
%MATRIX_REPORT Compute and print basic matrix diagnostics.
%   REPORT = MATRIX_REPORT(A) returns rank, determinant (for square A),
%   and the 2-norm condition number. All variables remain local.

validateattributes(A, {'numeric'}, {'2d', 'nonempty'}, mfilename, 'A');

report = struct();
report.Size = size(A);
report.Rank = rank(A);

if ismatrix(A) && size(A, 1) == size(A, 2)
    report.Determinant = det(A);
else
    report.Determinant = NaN;
end

report.ConditionNumber2 = cond(A);

fprintf('size = %d-by-%d\n', report.Size(1), report.Size(2));
fprintf('rank = %d\n', report.Rank);
if isnan(report.Determinant)
    fprintf('determinant = not defined for a non-square matrix\n');
else
    fprintf('determinant = %.8g\n', report.Determinant);
end
fprintf('2-norm condition number = %.8g\n', report.ConditionNumber2);
end
