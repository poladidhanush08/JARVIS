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
    await sim.start("tiny", speed=1)
    await asyncio.sleep(0.15)
    assert 1 <= sim.status()["emitted"] < TOTAL
    await sim.start("tiny", speed=10)
    await wait_finished(sim)
    ids = [e.id for e in engine.events()]
    assert sim.status()["emitted"] == sim.status()["total"] == TOTAL
    assert len(ids) == len(set(ids)) == TOTAL


async def test_start_other_scenario_clears_previous_events(sdir):
    steps = [{"at": t, "service": "auth-service", "type": "log", "level": "error", "message": f"other {i}"}
             for i, t in enumerate([0, 0.1, 0.2])]
    (sdir / "other.yaml").write_text(yaml.safe_dump(
        {"id": "other", "name": "Other", "description": "d", "duration": 1, "steps": steps}))
    sim, engine, _ = make(sdir)
    await sim.start("tiny", speed=1)
    await asyncio.sleep(0.15)
    assert len(engine.events()) >= 1
    await sim.start("other", speed=10)
    await wait_finished(sim)
    ids = [e.id for e in engine.events()]
    assert len(ids) == TOTAL and all(i.startswith("other-") for i in ids)


async def test_start_cancels_run_parked_in_on_events(sdir):
    engine = Engine()
    block = asyncio.Event()
    parked = asyncio.Event()
    calls = []

    async def on_events(evs):
        calls.append(evs[0].id)
        if len(calls) == 1:
            parked.set()
            await block.wait()

    sim = Simulator(engine, on_events, scenarios_dir=sdir)
    await sim.start("tiny", speed=10)
    await asyncio.wait_for(parked.wait(), 2)
    await sim.start("tiny", speed=10)
    block.set()
    await wait_finished(sim)
    ids = [e.id for e in engine.events()]
    assert sim.status()["emitted"] == sim.status()["total"] == TOTAL
    assert len(ids) == len(set(ids)) == TOTAL


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
    sim, engine, seen = make(sdir)
    await sim.start("tiny", speed=1)
    await asyncio.sleep(0.15)
    assert sim.status()["emitted"] >= 1
    await sim.reset()
    n = len(seen)
    await asyncio.sleep(0.3)
    assert sim.status()["state"] == "idle" and sim.status()["emitted"] == 0
    assert engine.events() == [] and len(seen) == n


async def test_on_events_error_finishes_and_is_logged(sdir, caplog):
    engine = Engine()

    async def boom(evs):
        raise RuntimeError("broadcast down")

    sim = Simulator(engine, boom, scenarios_dir=sdir)
    await sim.start("tiny", speed=10)
    await wait_finished(sim)
    assert "simulator run failed" in caplog.text
    await sim.start("tiny", speed=10)
    await wait_finished(sim)
    await sim.reset()


async def test_speed_clamped(sdir):
    sim, _, _ = make(sdir)
    await sim.set_speed(50)
    assert sim.status()["speed"] == 10
    await sim.set_speed(0.1)
    assert sim.status()["speed"] == 1
    for bad in (float("nan"), float("inf"), float("-inf")):
        await sim.set_speed(bad)
        assert sim.status()["speed"] == 1
    await sim.start("tiny", speed=float("nan"))
    assert sim.status()["speed"] == 1
    await sim.reset()
