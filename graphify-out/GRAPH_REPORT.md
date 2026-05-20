# Graph Report - backend/app  (2026-05-20)

## Corpus Check
- Corpus is ~2,802 words - fits in a single context window. You may not need a graph.

## Summary
- 161 nodes · 211 edges · 20 communities (17 shown, 3 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Recipe CRUD Layer|Recipe CRUD Layer]]
- [[_COMMUNITY_Configuration Models|Configuration Models]]
- [[_COMMUNITY_Hardware Protocols|Hardware Protocols]]
- [[_COMMUNITY_Mock PLC + Manager Wiring|Mock PLC + Manager Wiring]]
- [[_COMMUNITY_Hardware Manager Core|Hardware Manager Core]]
- [[_COMMUNITY_Mock ESP32 Driver|Mock ESP32 Driver]]
- [[_COMMUNITY_Mock Imada Driver|Mock Imada Driver]]
- [[_COMMUNITY_State Machine|State Machine]]
- [[_COMMUNITY_Waveform Service|Waveform Service]]
- [[_COMMUNITY_Async Event Bus|Async Event Bus]]
- [[_COMMUNITY_DB Engine|DB Engine]]

## God Nodes (most connected - your core abstractions)
1. `HardwareManager` - 20 edges
2. `RecipeService` - 15 edges
3. `MockPlc` - 14 edges
4. `MockEsp32` - 12 edges
5. `MockImada` - 12 edges
6. `PlcClient` - 8 edges
7. `WaveformService` - 8 edges
8. `PlcEvent` - 6 edges
9. `MockPlcScript` - 5 edges
10. `EventBus` - 5 edges

## Surprising Connections (you probably didn't know these)
- `HardwareManager` --uses--> `Settings`  [INFERRED]
  hardware/manager.py → config.py
- `list_recipes()` --calls--> `RecipeService`  [INFERRED]
  api/recipes.py → services/recipe_service.py
- `create_recipe()` --calls--> `RecipeService`  [INFERRED]
  api/recipes.py → services/recipe_service.py
- `get_recipe()` --calls--> `RecipeService`  [INFERRED]
  api/recipes.py → services/recipe_service.py
- `update_recipe()` --calls--> `RecipeService`  [INFERRED]
  api/recipes.py → services/recipe_service.py

## Communities (20 total, 3 thin omitted)

### Community 0 - "Recipe CRUD Layer"
Cohesion: 0.11
Nodes (12): create_recipe(), delete_recipe(), get_recipe(), list_recipes(), update_recipe(), Recipe, TestLoop, TestRun (+4 more)

### Community 1 - "Configuration Models"
Cohesion: 0.16
Nodes (15): Esp32Calibration, Esp32Config, HardwareConfig, ImadaConfig, PlcConfig, ServerConfig, Settings, StateTimeouts (+7 more)

### Community 2 - "Hardware Protocols"
Cohesion: 0.13
Nodes (7): bit(), Esp32Client, ImadaClient, PlcClient, PlcEvent, word(), Protocol

### Community 3 - "Mock PLC + Manager Wiring"
Cohesion: 0.16
Nodes (3): MockPlc, MockPlcScript, Optional script that auto-emits PLC bits to simulate the rig.      after_b3_to_b

### Community 5 - "Mock ESP32 Driver"
Cohesion: 0.2
Nodes (3): Esp32Reading, MockEsp32, Emits a ramp from 0 to target_n over ramp_ms and then holds.

### Community 6 - "Mock Imada Driver"
Cohesion: 0.2
Nodes (3): ImadaReading, MockImada, Emits a synthetic sine half-wave to simulate a tensile pull.

### Community 7 - "State Machine"
Cohesion: 0.29
Nodes (6): Enum, Event, RunMode, State, StateMachine, str

### Community 8 - "Waveform Service"
Cohesion: 0.25
Nodes (3): LoopSummary, WaveformSample, WaveformService

## Knowledge Gaps
- **5 isolated node(s):** `initial schema  Revision ID: 0001 Revises: Create Date: 2026-05-19`, `Emits a ramp from 0 to target_n over ramp_ms and then holds.`, `Emits a synthetic sine half-wave to simulate a tensile pull.`, `Optional script that auto-emits PLC bits to simulate the rig.      after_b3_to_b`, `WaveformSample`
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HardwareManager` connect `Hardware Manager Core` to `Configuration Models`, `Hardware Protocols`, `Mock PLC + Manager Wiring`, `Mock ESP32 Driver`, `Mock Imada Driver`?**
  _High betweenness centrality (0.366) - this node is a cross-community bridge._
- **Why does `Settings` connect `Configuration Models` to `Hardware Manager Core`?**
  _High betweenness centrality (0.281) - this node is a cross-community bridge._
- **Why does `RecipeService` connect `Recipe CRUD Layer` to `Configuration Models`?**
  _High betweenness centrality (0.227) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `HardwareManager` (e.g. with `Settings` and `Esp32Reading`) actually correct?**
  _`HardwareManager` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `RecipeService` (e.g. with `Recipe` and `RecipeCreate`) actually correct?**
  _`RecipeService` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `MockPlc` (e.g. with `HardwareManager` and `PlcEvent`) actually correct?**
  _`MockPlc` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `MockEsp32` (e.g. with `HardwareManager` and `Esp32Reading`) actually correct?**
  _`MockEsp32` has 3 INFERRED edges - model-reasoned connections that need verification._