function outputPath = plot_damped_sine(outputDir)
%PLOT_DAMPED_SINE Export a damped-sine plot without overwriting files.
%   OUTPUTPATH = PLOT_DAMPED_SINE(OUTPUTDIR) writes damped_sine.png, or the
%   first available suffixed name. The function uses an invisible figure,
%   closes only that figure, and does not pollute the base workspace.

if nargin < 1
    outputDir = pwd;
end

if ~(ischar(outputDir) || (isstring(outputDir) && isscalar(outputDir)))
    error('plot_damped_sine:InvalidOutputDir', ...
        'outputDir must be a character vector or string scalar.');
end
outputDir = char(outputDir);

if ~isfolder(outputDir)
    error('plot_damped_sine:InvalidFolder', ...
        'Output directory does not exist: %s', outputDir);
end

preferredPath = fullfile(outputDir, 'damped_sine.png');
outputPath = firstAvailablePath(preferredPath);

x = linspace(0, 20, 1000);
y = exp(-0.15 * x) .* sin(2 * x);

fig = figure('Visible', 'off');
cleanupFigure = onCleanup(@() close(fig)); %#ok<NASGU>
ax = axes('Parent', fig);

plot(ax, x, y, 'LineWidth', 1.5);
title(ax, 'Damped Sine: y = exp(-0.15x) sin(2x)');
xlabel(ax, 'x');
ylabel(ax, 'y');
grid(ax, 'on');

exportgraphics(fig, outputPath);

if ~isfile(outputPath)
    error('plot_damped_sine:ExportFailed', ...
        'Expected output file was not created: %s', outputPath);
end

fprintf('File path: %s\n', outputPath);
end

function outputPath = firstAvailablePath(preferredPath)
outputPath = preferredPath;
if ~isfile(outputPath)
    return
end

[folder, name, extension] = fileparts(preferredPath);
index = 1;
while true
    candidate = fullfile(folder, sprintf('%s_%d%s', name, index, extension));
    if ~isfile(candidate)
        outputPath = candidate;
        return
    end
    index = index + 1;
end
end
