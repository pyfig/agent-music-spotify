## Purpose

Define the TUI's layout budget, vertical space allocation, and graceful degradation order as terminal height shrinks, ensuring functional rows always survive.

## Requirements

### Requirement: Results list fills available vertical space

The results list SHALL size itself from the actual space remaining after the components currently rendered (title, input cluster, overlays, now-playing row, status bar), not from a fixed reserved-row constant. When the track list is longer than the visible area, the list SHALL scroll; when shorter, remaining space SHALL collapse rather than render as a void between the input and the footer.

#### Scenario: Small terminal shows a full-height list
- **WHEN** the terminal is 70×17 and a 24-track playlist is displayed with no overlay open
- **THEN** the results list occupies all rows not used by the title, input, now-playing row, and status bar (at least 8 track rows), with no multi-row empty gap below the input

#### Scenario: Large terminal unaffected
- **WHEN** the terminal is 120×40
- **THEN** the layout renders as before this change (list flexes, input cluster directly below the list, footer pinned to the bottom)

### Requirement: Graceful degradation order on short terminals

As terminal height shrinks, the UI SHALL hide decorative elements before functional ones, in this order: lyrics panel first, then logo, then slash-menu rows (already 3→2→1), then vertical padding. The prompt input, at least 5 result rows, the now-playing row (when playing), and the status bar SHALL remain visible at any height ≥ 12 rows. The compact lyrics panel SHALL be accounted for in the central layout budget (`layoutBudget`) via a dedicated flag and SHALL never displace functional rows.

#### Scenario: Height below logo threshold
- **WHEN** the terminal height is less than 12 rows
- **THEN** the logo is not rendered and the input, results, and status bar still fit without overflow

#### Scenario: Short terminal hides lyrics panel before logo
- **WHEN** lyrics mode is on with a synced track playing and the terminal height shrinks so that both the lyrics panel and the logo cannot fit
- **THEN** the lyrics panel is hidden while the logo (if height still permits it) and all functional rows remain visible

### Requirement: Narrow-width rendering never clips mid-word

At widths from 60 to 80 columns, status bar clusters SHALL truncate labels with an ellipsis rather than hard-clip, the left and right status clusters SHALL not overlap, and track rows SHALL wrap with hanging indent (existing behavior preserved). The content column SHALL never exceed the terminal width.

#### Scenario: Narrow terminal status bar
- **WHEN** the terminal is 60 columns wide, a long provider:model label is active, tracks are excluded, and volume is shown
- **THEN** the model label truncates with an ellipsis and the volume/hint cluster remains fully visible with no overlapping text
