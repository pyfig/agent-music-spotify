## MODIFIED Requirements

### Requirement: Results list fills available vertical space

The results list SHALL size itself from the actual space remaining after the components currently rendered (title, input cluster, overlays, now-playing row, status bar), not from a fixed reserved-row constant. When the track list is longer than the visible area, the list SHALL scroll; when shorter, remaining space SHALL collapse rather than render as a void between the input and the footer. No layout element (including flex spacers used to bottom-anchor the lyrics panel and status bar) SHALL expand to occupy leftover terminal height as a visible blank region; bottom-anchoring SHALL be achieved without producing an empty band between the input cluster and the footer.

#### Scenario: Small terminal shows a full-height list
- **WHEN** the terminal is 70×17 and a 24-track playlist is displayed with no overlay open
- **THEN** the results list occupies all rows not used by the title, input, now-playing row, and status bar (at least 8 track rows), with no multi-row empty gap below the input

#### Scenario: Large terminal unaffected
- **WHEN** the terminal is 120×40
- **THEN** the layout renders as before this change (list flexes, input cluster directly below the list, footer pinned to the bottom)

#### Scenario: Tall terminal with short result list shows no blank band
- **WHEN** the terminal is 120×50 and the result list contains only 3 tracks (or is empty pre-generation)
- **THEN** the results list collapses to its content height, and no unbounded blank region appears between the input cluster and the lyrics panel/status bar footer
