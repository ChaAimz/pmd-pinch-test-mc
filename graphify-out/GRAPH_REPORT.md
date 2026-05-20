# Graph Report - c:/Users/Aimz/source/repos/pmd-pinch-test-mc  (2026-05-20)

## Corpus Check
- Corpus is ~43,477 words - fits in a single context window. You may not need a graph.

## Summary
- 508 nodes · 722 edges · 52 communities (44 shown, 8 thin omitted)
- Extraction: 77% EXTRACTED · 23% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_System Architecture & Docs|System Architecture & Docs]]
- [[_COMMUNITY_Frontend UI Components|Frontend UI Components]]
- [[_COMMUNITY_Runs & History API|Runs & History API]]
- [[_COMMUNITY_Hardware Layer|Hardware Layer]]
- [[_COMMUNITY_Hardware Control API|Hardware Control API]]
- [[_COMMUNITY_Test Execution Engine|Test Execution Engine]]
- [[_COMMUNITY_Waveform & Charts|Waveform & Charts]]
- [[_COMMUNITY_Recipe Management|Recipe Management]]
- [[_COMMUNITY_Events & WebSocket|Events & WebSocket]]
- [[_COMMUNITY_Hardware Protocols|Hardware Protocols]]
- [[_COMMUNITY_Config & API Client|Config & API Client]]
- [[_COMMUNITY_Hardware Tests|Hardware Tests]]
- [[_COMMUNITY_State Machine|State Machine]]
- [[_COMMUNITY_Session Control|Session Control]]
- [[_COMMUNITY_Concurrency Model|Concurrency Model]]
- [[_COMMUNITY_Chart State|Chart State]]
- [[_COMMUNITY_App Shell|App Shell]]
- [[_COMMUNITY_Data Storage|Data Storage]]
- [[_COMMUNITY_Timeout Config|Timeout Config]]
- [[_COMMUNITY_WS Backpressure|WS Backpressure]]
- [[_COMMUNITY_Layout Component|Layout Component]]
- [[_COMMUNITY_E2E Tests|E2E Tests]]
- [[_COMMUNITY_Error States|Error States]]
- [[_COMMUNITY_Frontend README|Frontend README]]

## God Nodes (most connected - your core abstractions)
1. `TestRunner` - 31 edges
2. `HardwareManager` - 25 edges
3. `RecipeService` - 20 edges
4. `Plan 1: Backend Foundation + Mock E2E` - 20 edges
5. `Pinch Test Machine Design Spec` - 17 edges
6. `MockPlc` - 16 edges
7. `cn()` - 16 edges
8. `WaveformService` - 14 edges
9. `_load_or_default()` - 13 edges
10. `build_app()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `SVG Icon Sprite (bluesky, discord, docs, github, social, x)` --conceptually_related_to--> `Plan 2: Frontend Vite+React+ShadcnUI+uPlot`  [INFERRED]
  frontend/public/icons.svg → docs/superpowers/plans/2026-05-20-plan-2-frontend.md
- `build_app()` --calls--> `init_engine()`  [INFERRED]
  backend/app/main.py → backend/app/db/engine.py
- `test_esp32_reading_dataclass()` --calls--> `Esp32Reading`  [INFERRED]
  backend/tests/unit/test_hardware_base.py → backend/app/hardware/base.py
- `PLC Bit/Word Map` --references--> `Pinch Test Machine Design Spec`  [EXTRACTED]
  CLAUDE.md → docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md
- `pages/Hardware.tsx (status + reconnect + calibration wizard)` --implements--> `ESP32 Calibration (slope/offset)`  [INFERRED]
  docs/superpowers/plans/2026-05-20-plan-4-frontend-history-hardware.md → CLAUDE.md

## Hyperedges (group relationships)
- **Serial Hardware Thread Trio** — claude_md_plc_thread, claude_md_imada_thread, claude_md_esp32_thread [EXTRACTED 1.00]
- **Mock Driver Trio** — plan1_mock_plc, plan1_mock_imada, plan1_mock_esp32 [EXTRACTED 1.00]
- **Full Test Loop State Sequence** — spec_state_idle, spec_state_write_plc, spec_state_loop_begin, spec_state_clamp_pressed, spec_state_wait_clamp, spec_state_wait_b5, spec_state_tension_check, spec_state_evaluate, spec_state_unclamp, spec_state_done_b7 [EXTRACTED 1.00]
- **Frontend Real-Time Data Flow** — plan2_ws_client, plan2_app_store, plan2_chart_store, plan2_waveform_chart, plan2_run_page [EXTRACTED 1.00]
- **Hardware Device Config Trio** — config_yaml_hardware_plc, config_yaml_hardware_imada, config_yaml_hardware_esp32 [EXTRACTED 1.00]

## Communities (52 total, 8 thin omitted)

### Community 0 - "System Architecture & Docs"
Cohesion: 0.05
Nodes (55): FastAPI Backend, Pinch Test Machine Project, PLC Bit/Word Map, Recipe Judgment (pass/fail logic), Test Runner (asyncio task), WebSocket Hub, Imada Hardware Config (COM5, 19200), PLC Hardware Config (COM3, 38400) (+47 more)

### Community 1 - "Frontend UI Components"
Cohesion: 0.05
Nodes (11): StateBadge(), cn(), AlertDialog(), AlertDialogCancel(), Badge(), Dialog(), Input(), Skeleton() (+3 more)

### Community 2 - "Runs & History API"
Cohesion: 0.06
Nodes (17): configure_logging(), build_app(), Recipe, TestLoop, TestRun, client(), client(), client() (+9 more)

### Community 3 - "Hardware Layer"
Cohesion: 0.06
Nodes (10): Esp32Reading, HardwareManager, MockEsp32, Emits a ramp from 0 to target_n over ramp_ms and then holds., MockPlc, MockPlcScript, Optional script that auto-emits PLC bits to simulate the rig.      after_b3_to_b, test_mock_esp32_ramps_to_target() (+2 more)

### Community 4 - "Hardware Control API"
Cohesion: 0.1
Nodes (32): status(), Esp32Calibration, Esp32Config, HardwareConfig, ImadaConfig, load_settings(), PlcConfig, ServerConfig (+24 more)

### Community 5 - "Test Execution Engine"
Cohesion: 0.09
Nodes (15): get_engine(), get_session(), init_engine(), Enum, Event, RunMode, State, _now_iso() (+7 more)

### Community 6 - "Waveform & Charts"
Cohesion: 0.07
Nodes (10): WaveformChart(), useSessionControl(), getWsClient(), resetWsClient(), WsClient, SelectContent(), SelectItem(), SelectTrigger() (+2 more)

### Community 7 - "Recipe Management"
Cohesion: 0.14
Nodes (16): create_recipe(), delete_recipe(), get_recipe(), list_recipes(), update_recipe(), RecipeBase, RecipeCreate, RecipeRead (+8 more)

### Community 8 - "Events & WebSocket"
Cohesion: 0.1
Nodes (9): _now_iso(), test_abort_mid_session(), test_full_session_two_loops_pass(), field(), EventBus, WsHub, test_publish_to_subscribers(), test_unsubscribe_after_drop() (+1 more)

### Community 9 - "Hardware Protocols"
Cohesion: 0.13
Nodes (7): bit(), Esp32Client, ImadaClient, PlcClient, PlcEvent, word(), Protocol

### Community 10 - "Config & API Client"
Cohesion: 0.13
Nodes (19): ESP32 Calibration (slope/offset), ESP32 Hardware Config (COM7, 115200), lib/api.ts (REST fetch wrapper), store/app.ts (Zustand machine state), store/chart.ts (ring buffer Zustand), components/HwStatusBar.tsx, pages/RecipeForm.tsx (dialog form), pages/Recipes.tsx (CRUD) (+11 more)

### Community 11 - "Hardware Tests"
Cohesion: 0.12
Nodes (6): ImadaReading, MockImada, Emits a synthetic sine half-wave to simulate a tensile pull., test_esp32_reading_dataclass(), test_imada_reading_dataclass(), test_mock_imada_streams_at_target_rate()

### Community 13 - "State Machine"
Cohesion: 0.27
Nodes (6): StateMachine, test_abort_from_any_state(), test_error_event_transitions_to_error(), test_full_happy_path_auto_mode(), test_manual_mode_waits_for_clamp_command(), test_reset_returns_to_idle()

### Community 14 - "Session Control"
Cohesion: 0.25
Nodes (3): start_session(), SessionStartRequest, SessionStartResponse

### Community 15 - "Concurrency Model"
Cohesion: 0.29
Nodes (7): asyncio.Queue Thread Bridge, ESP32 Thread (pyserial), HardwareManager, Imada Thread (pyserial), Mock Mode (config.yaml mock_mode), PLC Thread (pyserial/KV-Link), mock_mode: true (default)

### Community 19 - "Data Storage"
Cohesion: 0.67
Nodes (3): Parquet Waveform Storage, SQLite Storage (pinch.db), Storage Config (SQLite + waveforms dir)

## Knowledge Gaps
- **36 isolated node(s):** `initial schema  Revision ID: 0001 Revises: Create Date: 2026-05-19`, `Emits a ramp from 0 to target_n over ramp_ms and then holds.`, `Emits a synthetic sine half-wave to simulate a tensile pull.`, `Optional script that auto-emits PLC bits to simulate the rig.      after_b3_to_b`, `WebSocket must emit at least one state_change and a run_finished message.` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WsHub` connect `Events & WebSocket` to `Runs & History API`?**
  _High betweenness centrality (0.197) - this node is a cross-community bridge._
- **Why does `Input()` connect `Frontend UI Components` to `Events & WebSocket`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `TestRunner` (e.g. with `Settings` and `Recipe`) actually correct?**
  _`TestRunner` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `HardwareManager` (e.g. with `Settings` and `Esp32Reading`) actually correct?**
  _`HardwareManager` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `RecipeService` (e.g. with `Recipe` and `RecipeCreate`) actually correct?**
  _`RecipeService` has 13 INFERRED edges - model-reasoned connections that need verification._
- **What connects `initial schema  Revision ID: 0001 Revises: Create Date: 2026-05-19`, `Emits a ramp from 0 to target_n over ramp_ms and then holds.`, `Emits a synthetic sine half-wave to simulate a tensile pull.` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `System Architecture & Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._