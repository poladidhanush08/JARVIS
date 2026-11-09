import asyncio

import pytest
import yaml

from jarvis.engine import Engine
from jarvis.simulator import Simulator

TOTAL = 3


@pytest.fixture
def sdir(tmp_path):
    steps = [{"at": t, "service": "user-db", "type": "log", "level": "error", "message": f"boom {i}"}
             for i, t in enumerate([0, 0.1, 0.2])]
    (tmp_path / "tiny.yaml").write_text(yaml.safe_dump(
        {"id": "tiny", "name": "Tiny", "description": "d", "duration": 1, "steps": steps}))
    return tmp_path


def make(sdir):
    engine = Engine()
    seen = []

    async def on_events(evs):
        seen.extend(evs)

    return Simulator(engine, on_events, scenarios_dir=sdir), engine, seen


async def wait_finished(sim, timeout=5.0):
    for _ in range(int(timeout / 0.02)):
        if sim.status()["state"] == "finished":
            return
        await asyncio.sleep(0.02)
    raise AssertionError(sim.status())


async def test_runs_to_completion(sdir):
    sim, engine, seen = make(sdir)
    await sim.start("tiny", speed=10)
    await wait_finished(sim)
    assert sim.status() == {"scenario": "tiny", "state": "finished", "speed": 10, "emitted": TOTAL, "total": TOTAL}
    assert len(seen) == TOTAL and len(engine.events()) == TOTAL


async def test_start_twice_cancels_previous_without_duplicates(sdir):
    sim, engine, seen = make(sdir)
    await sim.start("tiny", speed=10)
    await sim.start("tiny", speed=10)
    await wait_finished(sim)
    assert sim.status()["emitted"] == sim.status()["total"] == TOTAL
    assert len(engine.events()) == TOTAL


async def test_pause_stops_emission(sdir):
    sim, engine, _ = make(sdir)
    await sim.start("tiny", speed=1)
    await asyncio.sleep(0.05)
    await sim.pause()
    n = sim.status()["emitted"]
    assert sim.status()["state"] == "paused" and n >= 1
    await asyncio.sleep(0.3)
    assert sim.status()["emitted"] == n
    await sim.set_speed(10)
    await sim.resume()
    await wait_finished(sim)
    assert len(engine.events()) == TOTAL


async def test_reset_returns_to_idle(sdir):
    sim, engine, _ = make(sdir)
    await sim.start("tiny", speed=1)
    await sim.reset()
    assert sim.status()["state"] == "idle" and engine.events() == []


async def test_speed_clamped(sdir):
    sim, _, _ = make(sdir)
    await sim.set_speed(50)
    assert sim.status()["speed"] == 10
    await sim.set_speed(0.1)
    assert sim.status()["speed"] == 1
