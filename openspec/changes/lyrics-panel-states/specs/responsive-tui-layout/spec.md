## MODIFIED Requirements

### Requirement: Graceful degradation order on short terminals

As terminal height shrinks, the UI SHALL hide decorative elements before functional ones, in this order: lyrics panel first, then logo, then slash-menu rows (already 3→2→1), then vertical padding. The prompt input, at least 5 result rows, the now-playing row (when playing), and the status bar SHALL remain visible at any height ≥ 12 rows. The compact lyrics panel SHALL be accounted for in the central layout budget (`layoutBudget`) via a dedicated flag driven by lyrics mode being enabled (not by synced lyrics being loaded) and SHALL never displace functional rows.

#### Scenario: Height below logo threshold
- **WHEN** the terminal height is less than 12 rows
- **THEN** the logo is not rendered and the input, results, and status bar still fit without overflow

#### Scenario: Short terminal hides lyrics panel before logo
- **WHEN** lyrics mode is on and the terminal height shrinks so that both the lyrics panel and the logo cannot fit
- **THEN** the lyrics panel is hidden while the logo (if height still permits it) and all functional rows remain visible

### Requirement: Narrow-width rendering never clips mid-word

At widths from 60 to 80 columns, status bar clusters SHALL truncate labels with an ellipsis rather than hard-clip, the left and right status clusters SHALL not overlap, and track rows SHALL render on a single line, truncating overlong artist/title text with an ellipsis instead of wrapping onto continuation lines. The content column SHALL never exceed the terminal width.

#### Scenario: Narrow terminal status bar
- **WHEN** the terminal is 60 columns wide, a long provider:model label is active, tracks are excluded, and volume is shown
- **THEN** the model label truncates with an ellipsis and the volume/hint cluster remains fully visible with no overlapping text

#### Scenario: Long track title stays on one row
- **WHEN** a track whose artist — title text exceeds the content column width is displayed in the results list
- **THEN** the row renders as exactly one line ending in an ellipsis, and no continuation line appears that could be mistaken for lyric text
