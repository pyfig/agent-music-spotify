## MODIFIED Requirements

### Requirement: Graceful degradation order on short terminals
As terminal height shrinks, the UI SHALL hide decorative elements before functional ones, in this order: lyrics panel first, then logo, then slash-menu rows (already 3→2→1), then vertical padding. The prompt input, at least 5 result rows, the now-playing row (when playing), and the status bar SHALL remain visible at any height ≥ 12 rows. The compact lyrics panel SHALL be accounted for in the central layout budget (`layoutBudget`) via a dedicated flag and SHALL never displace functional rows.

#### Scenario: Height below logo threshold
- **WHEN** the terminal height is less than 12 rows
- **THEN** the logo is not rendered and the input, results, and status bar still fit without overflow

#### Scenario: Short terminal hides lyrics panel before logo
- **WHEN** lyrics mode is on with a synced track playing and the terminal height shrinks so that both the lyrics panel and the logo cannot fit
- **THEN** the lyrics panel is hidden while the logo (if height still permits it) and all functional rows remain visible
