#!/usr/bin/env python3
"""Comprehensive test suite for twnr-bigbang CLI tool."""

import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import Counter, defaultdict


# Path to the CLI tool - adjust if needed
CLI_TOOL = os.environ.get("BIGBANG_CLI", "node twnr-bigbang.js")
WORKDIR = os.environ.get("BIGBANG_WORKDIR", os.getcwd())

# Port class definitions: class -> (fuel, org, equ) where B=buy, S=sell
PORT_CLASSES = {
    1: ("B", "B", "S"),
    2: ("B", "S", "B"),
    3: ("S", "B", "B"),
    4: ("S", "S", "B"),
    5: ("B", "S", "S"),
    6: ("S", "B", "S"),
    7: ("S", "S", "S"),
    8: ("B", "B", "B"),
}

VALID_PLANET_TYPES = {"Earth-like", "Volcanic", "Glacial", "Gaseous", "Mountainous"}


def run_cli(args_str, cwd=None):
    """Run the CLI tool and return (returncode, stdout, stderr)."""
    cmd = f"{CLI_TOOL} {args_str}"
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        cwd=cwd or WORKDIR
    )
    return result.returncode, result.stdout, result.stderr


def make_temp_dir():
    """Create a temp directory for test output."""
    return tempfile.mkdtemp(prefix="bigbang_test_")


def read_csv_file(filepath):
    """Read a CSV file and return (header, rows)."""
    with open(filepath, "r", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    return header, rows


def generate_universe(sectors=100, seed=42, port_density=50, planet_density=20,
                      two_way_pct=None):
    """Helper: generate a universe and return the output directory path."""
    outdir = make_temp_dir()
    # Remove it so the tool can create it
    shutil.rmtree(outdir)
    args = (
        f"{outdir} --sectors {sectors} --seed {seed} "
        f"--port-density {port_density} --planet-density {planet_density}"
    )
    if two_way_pct is not None:
        args += f" --two-way-pct {two_way_pct}"
    rc, stdout, stderr = run_cli(args)
    if rc != 0:
        raise RuntimeError(
            f"CLI failed with code {rc}.\nstdout: {stdout}\nstderr: {stderr}"
        )
    return outdir


def compute_bidirectional_pct(warp_rows):
    """Compute the percentage of warps that are bidirectional.

    A warp A->B is bidirectional if B->A also exists.
    Returns (bidirectional_count, total_count, percentage).
    """
    warp_set = set()
    for row in warp_rows:
        warp_set.add((int(row[0]), int(row[1])))
    total = len(warp_set)
    if total == 0:
        return 0, 0, 0.0
    bidi_count = 0
    for (a, b) in warp_set:
        if (b, a) in warp_set:
            bidi_count += 1
    # bidi_count counts each direction separately, which is correct:
    # if A->B and B->A both exist, both are "bidirectional warps"
    pct = (bidi_count / total) * 100
    return bidi_count, total, pct


# ============================================================================
# CLI ARGUMENT VALIDATION
# ============================================================================

class TestCLIValidation(unittest.TestCase):
    """Tests for CLI argument validation and error handling."""

    def test_missing_sectors_flag(self):
        """Missing --sectors should exit 1 with error to stderr."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir}")
        self.assertEqual(rc, 1, "Should exit 1 when --sectors is missing")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_sectors_below_minimum(self):
        """--sectors below 20 should exit 1 with error to stderr."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 19")
        self.assertEqual(rc, 1, "Should exit 1 when sectors < 20")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_sectors_above_maximum(self):
        """--sectors above 5000 should exit 1 with error to stderr."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 5001")
        self.assertEqual(rc, 1, "Should exit 1 when sectors > 5000")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_output_dir_exists_not_empty(self):
        """Existing non-empty output dir should exit 1 with error to stderr."""
        outdir = make_temp_dir()
        with open(os.path.join(outdir, "dummy.txt"), "w") as f:
            f.write("dummy")
        rc, _, stderr = run_cli(f"{outdir} --sectors 20")
        self.assertEqual(rc, 1, "Should exit 1 when output dir is non-empty")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")
        shutil.rmtree(outdir)

    def test_output_dir_created_if_not_exists(self):
        """Output dir should be created if it doesn't exist."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --seed 1")
        self.assertEqual(rc, 0, f"Should exit 0 on valid invocation. stderr: {stderr}")
        self.assertTrue(os.path.isdir(outdir), "Output dir should be created")
        shutil.rmtree(outdir)

    def test_valid_run_exit_code_zero(self):
        """Valid invocation should exit with code 0."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --seed 1")
        self.assertEqual(rc, 0, f"Should exit 0 on valid run. stderr: {stderr}")
        shutil.rmtree(outdir)

    def test_port_density_out_of_range_zero(self):
        """--port-density 0 should exit 1 (range is 1-100)."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --port-density 0")
        self.assertEqual(rc, 1, "Should exit 1 when port-density is 0")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_port_density_out_of_range_high(self):
        """--port-density 101 should exit 1."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --port-density 101")
        self.assertEqual(rc, 1, "Should exit 1 when port-density > 100")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_planet_density_out_of_range_high(self):
        """--planet-density 101 should exit 1."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --planet-density 101")
        self.assertEqual(rc, 1, "Should exit 1 when planet-density > 100")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_two_way_pct_out_of_range_negative(self):
        """--two-way-pct -1 should exit 1."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --two-way-pct -1")
        self.assertEqual(rc, 1, "Should exit 1 when two-way-pct < 0")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_two_way_pct_out_of_range_high(self):
        """--two-way-pct 101 should exit 1."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --two-way-pct 101")
        self.assertEqual(rc, 1, "Should exit 1 when two-way-pct > 100")
        self.assertTrue(len(stderr.strip()) > 0, "Should print error to stderr")

    def test_existing_empty_dir_succeeds(self):
        """An existing but empty output directory should be accepted."""
        outdir = make_temp_dir()
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --seed 1")
        self.assertEqual(rc, 0, f"Existing empty dir should be accepted. stderr: {stderr}")
        self.assertTrue(os.path.exists(os.path.join(outdir, "sectors.csv")),
                        "Should still generate output in existing empty dir")
        shutil.rmtree(outdir)

    def test_minimum_sectors_produces_correct_count(self):
        """--sectors 20 (minimum) should produce exactly 20 sectors in the CSV."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --seed 1")
        self.assertEqual(rc, 0, f"Should exit 0. stderr: {stderr}")
        header, rows = read_csv_file(os.path.join(outdir, "sectors.csv"))
        self.assertEqual(len(rows), 20,
                         f"--sectors 20 should produce 20 sectors, got {len(rows)}")
        shutil.rmtree(outdir)


# ============================================================================
# DEFAULT VALUES
# ============================================================================

class TestDefaultValues(unittest.TestCase):
    """Tests that default values for optional params work correctly."""

    def test_default_port_density_is_50(self):
        """Omitting --port-density should default to 50%."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 100 --seed 777")
        self.assertEqual(rc, 0, f"Should succeed without optional flags. stderr: {stderr}")
        _, rows = read_csv_file(os.path.join(outdir, "ports.csv"))
        expected = 99 * 50 / 100
        actual = len(rows)
        self.assertGreaterEqual(actual, expected * 0.5,
                                f"Default port density should be ~50%. Got {actual} ports")
        self.assertLessEqual(actual, expected * 1.5,
                             f"Default port density should be ~50%. Got {actual} ports")
        shutil.rmtree(outdir)

    def test_default_planet_density_is_5(self):
        """Omitting --planet-density should default to 5%."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 200 --seed 777")
        self.assertEqual(rc, 0, f"Should succeed without optional flags. stderr: {stderr}")
        _, rows = read_csv_file(os.path.join(outdir, "planets.csv"))
        sectors_with_planets = len(set(int(row[0]) for row in rows))
        expected = 199 * 5 / 100
        self.assertGreaterEqual(sectors_with_planets, max(1, expected * 0.3),
                                f"Default planet density should be ~5%. "
                                f"Got {sectors_with_planets} sectors with planets")
        self.assertLessEqual(sectors_with_planets, expected * 3,
                             f"Default planet density should be ~5%. "
                             f"Got {sectors_with_planets} sectors with planets")
        shutil.rmtree(outdir)

    def test_default_two_way_pct_is_90(self):
        """Omitting --two-way-pct should default to 90% bidirectional warps."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 100 --seed 777")
        self.assertEqual(rc, 0, f"Should succeed without --two-way-pct. stderr: {stderr}")
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        _, _, pct = compute_bidirectional_pct(warp_rows)
        self.assertGreaterEqual(pct, 89.0,
                                f"Default two-way-pct should be ~90%. Got {pct:.1f}%")
        self.assertLessEqual(pct, 91.0,
                             f"Default two-way-pct should be ~90%. Got {pct:.1f}%")
        shutil.rmtree(outdir)

    def test_optional_params_omitted_succeeds(self):
        """Running with only required params (--sectors) should succeed."""
        outdir = make_temp_dir()
        shutil.rmtree(outdir)
        rc, _, stderr = run_cli(f"{outdir} --sectors 20 --seed 1")
        self.assertEqual(rc, 0, f"Should succeed with only required params. stderr: {stderr}")
        for fname in ["sectors.csv", "warps.csv", "ports.csv", "planets.csv", "import.sql"]:
            self.assertTrue(os.path.exists(os.path.join(outdir, fname)),
                            f"{fname} should exist when using defaults")
        shutil.rmtree(outdir)


# ============================================================================
# SEED REPRODUCIBILITY
# ============================================================================

class TestSeedReproducibility(unittest.TestCase):
    """Tests for seed-based reproducible generation."""

    def test_same_seed_produces_identical_output(self):
        """Same seed + same options must produce identical output files."""
        outdir1 = generate_universe(sectors=50, seed=12345, port_density=50,
                                    planet_density=10, two_way_pct=70)
        outdir2 = generate_universe(sectors=50, seed=12345, port_density=50,
                                    planet_density=10, two_way_pct=70)
        for fname in ["sectors.csv", "warps.csv", "ports.csv", "planets.csv", "import.sql"]:
            path1 = os.path.join(outdir1, fname)
            path2 = os.path.join(outdir2, fname)
            self.assertTrue(os.path.exists(path1), f"{fname} must exist in run 1")
            self.assertTrue(os.path.exists(path2), f"{fname} must exist in run 2")
            with open(path1) as f1, open(path2) as f2:
                content1 = f1.read()
                content2 = f2.read()
            self.assertEqual(content1, content2,
                             f"{fname} differs between two runs with the same seed")
        shutil.rmtree(outdir1)
        shutil.rmtree(outdir2)


# ============================================================================
# OUTPUT FILES
# ============================================================================

class TestOutputFiles(unittest.TestCase):
    """Tests that all required output files are generated."""

    @classmethod
    def setUpClass(cls):
        cls.outdir = generate_universe(sectors=100, seed=42, port_density=50,
                                       planet_density=20)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_sectors_csv_exists(self):
        self.assertTrue(os.path.exists(os.path.join(self.outdir, "sectors.csv")))

    def test_warps_csv_exists(self):
        self.assertTrue(os.path.exists(os.path.join(self.outdir, "warps.csv")))

    def test_ports_csv_exists(self):
        self.assertTrue(os.path.exists(os.path.join(self.outdir, "ports.csv")))

    def test_planets_csv_exists(self):
        self.assertTrue(os.path.exists(os.path.join(self.outdir, "planets.csv")))

    def test_import_sql_exists(self):
        self.assertTrue(os.path.exists(os.path.join(self.outdir, "import.sql")))


# ============================================================================
# SECTOR GENERATION
# ============================================================================

class TestSectorGeneration(unittest.TestCase):
    """Tests for sector generation rules."""

    @classmethod
    def setUpClass(cls):
        cls.num_sectors = 100
        cls.outdir = generate_universe(sectors=cls.num_sectors, seed=42)
        cls.header, cls.rows = read_csv_file(os.path.join(cls.outdir, "sectors.csv"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_sectors_csv_header(self):
        """sectors.csv must have header: id, name."""
        self.assertEqual(self.header, ["id", "name"])

    def test_correct_number_of_sectors(self):
        """There should be exactly N sector rows."""
        self.assertEqual(len(self.rows), self.num_sectors)

    def test_sectors_numbered_1_through_n(self):
        """Sector IDs should be 1 through N."""
        ids = sorted(int(row[0]) for row in self.rows)
        self.assertEqual(ids, list(range(1, self.num_sectors + 1)))

    def test_sector_1_named_federation_space(self):
        """Sector 1 must be named 'Federation Space'."""
        sector_1 = [row for row in self.rows if int(row[0]) == 1]
        self.assertEqual(len(sector_1), 1)
        self.assertEqual(sector_1[0][1], "Federation Space")

    def test_exactly_one_stardock(self):
        """Exactly one sector should be named 'Stardock'."""
        stardock_sectors = [row for row in self.rows if row[1] == "Stardock"]
        self.assertEqual(len(stardock_sectors), 1, "There must be exactly one Stardock sector")

    def test_stardock_not_sector_1(self):
        """Stardock must not be sector 1."""
        stardock_sectors = [row for row in self.rows if row[1] == "Stardock"]
        self.assertNotEqual(int(stardock_sectors[0][0]), 1, "Stardock must not be sector 1")

    def test_other_sectors_empty_name(self):
        """All sectors other than 1 and Stardock should have empty name."""
        for row in self.rows:
            sid = int(row[0])
            name = row[1]
            if sid == 1:
                continue
            if name == "Stardock":
                continue
            self.assertEqual(name, "", f"Sector {sid} should have empty name, got '{name}'")


# ============================================================================
# WARP GENERATION
# ============================================================================

class TestWarpGeneration(unittest.TestCase):
    """Tests for warp lane generation rules."""

    @classmethod
    def setUpClass(cls):
        cls.num_sectors = 100
        cls.outdir = generate_universe(sectors=cls.num_sectors, seed=42)
        cls.header, cls.rows = read_csv_file(os.path.join(cls.outdir, "warps.csv"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_warps_csv_header(self):
        """warps.csv must have header: sector_from, sector_to."""
        self.assertEqual(self.header, ["sector_from", "sector_to"])

    def test_outbound_warp_count_per_sector(self):
        """Each sector must have between 1 and 6 outbound warps."""
        outbound = Counter(int(row[0]) for row in self.rows)
        for sid in range(1, self.num_sectors + 1):
            count = outbound.get(sid, 0)
            self.assertGreaterEqual(count, 1,
                                    f"Sector {sid} has {count} outbound warps (min 1)")
            self.assertLessEqual(count, 6,
                                 f"Sector {sid} has {count} outbound warps (max 6)")

    def test_inbound_warp_count_per_sector(self):
        """Each sector must have between 1 and 6 inbound warps."""
        inbound = Counter(int(row[1]) for row in self.rows)
        for sid in range(1, self.num_sectors + 1):
            count = inbound.get(sid, 0)
            self.assertGreaterEqual(count, 1,
                                    f"Sector {sid} has {count} inbound warps (min 1)")
            self.assertLessEqual(count, 6,
                                 f"Sector {sid} has {count} inbound warps (max 6)")

    def test_no_self_warps(self):
        """No sector should have a warp to itself."""
        for row in self.rows:
            self.assertNotEqual(row[0], row[1],
                                f"Self-warp detected: sector {row[0]}")

    def test_no_duplicate_warps(self):
        """No duplicate warp pairs allowed."""
        pairs = [(row[0], row[1]) for row in self.rows]
        self.assertEqual(len(pairs), len(set(pairs)), "Duplicate warps detected")

    def test_warp_sectors_in_range(self):
        """All warp from/to sectors must be in range 1-N."""
        for row in self.rows:
            sf = int(row[0])
            st = int(row[1])
            self.assertGreaterEqual(sf, 1)
            self.assertLessEqual(sf, self.num_sectors)
            self.assertGreaterEqual(st, 1)
            self.assertLessEqual(st, self.num_sectors)

    def test_strong_connectivity(self):
        """The sector graph must be strongly connected."""
        adj = defaultdict(set)
        for row in self.rows:
            adj[int(row[0])].add(int(row[1]))

        all_sectors = set(range(1, self.num_sectors + 1))

        visited_forward = set()
        queue = [1]
        visited_forward.add(1)
        while queue:
            current = queue.pop(0)
            for neighbor in adj[current]:
                if neighbor not in visited_forward:
                    visited_forward.add(neighbor)
                    queue.append(neighbor)

        self.assertEqual(visited_forward, all_sectors,
                         f"Forward BFS from sector 1 only reached "
                         f"{len(visited_forward)}/{self.num_sectors} sectors")

        rev_adj = defaultdict(set)
        for row in self.rows:
            rev_adj[int(row[1])].add(int(row[0]))

        visited_reverse = set()
        queue = [1]
        visited_reverse.add(1)
        while queue:
            current = queue.pop(0)
            for neighbor in rev_adj[current]:
                if neighbor not in visited_reverse:
                    visited_reverse.add(neighbor)
                    queue.append(neighbor)

        self.assertEqual(visited_reverse, all_sectors,
                         f"Reverse BFS from sector 1 only reached "
                         f"{len(visited_reverse)}/{self.num_sectors} sectors")

    def _check_strong_connectivity(self, warp_rows, num_sectors, label=""):
        """Helper: verify strong connectivity via dual BFS."""
        adj = defaultdict(set)
        for row in warp_rows:
            adj[int(row[0])].add(int(row[1]))
        all_sectors = set(range(1, num_sectors + 1))

        visited = set()
        queue = [1]
        visited.add(1)
        while queue:
            current = queue.pop(0)
            for neighbor in adj[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        self.assertEqual(visited, all_sectors,
                         f"{label}Forward BFS reached {len(visited)}/{num_sectors}")

        rev_adj = defaultdict(set)
        for row in warp_rows:
            rev_adj[int(row[1])].add(int(row[0]))
        visited_rev = set()
        queue = [1]
        visited_rev.add(1)
        while queue:
            current = queue.pop(0)
            for neighbor in rev_adj[current]:
                if neighbor not in visited_rev:
                    visited_rev.add(neighbor)
                    queue.append(neighbor)
        self.assertEqual(visited_rev, all_sectors,
                         f"{label}Reverse BFS reached {len(visited_rev)}/{num_sectors}")

    def test_strong_connectivity_500_sectors(self):
        """Strong connectivity and inbound limits must hold at 500 sectors."""
        outdir = generate_universe(sectors=500, seed=99)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._check_strong_connectivity(warp_rows, 500, "500 sectors: ")
        inbound = Counter(int(row[1]) for row in warp_rows)
        for sid in range(1, 501):
            count = inbound.get(sid, 0)
            self.assertGreaterEqual(count, 1,
                                    f"500 sectors: Sector {sid} has {count} inbound (min 1)")
            self.assertLessEqual(count, 6,
                                 f"500 sectors: Sector {sid} has {count} inbound (max 6)")
        shutil.rmtree(outdir)

    def test_strong_connectivity_low_bidirectionality(self):
        """Strong connectivity and inbound limits must hold with --two-way-pct 0 at 500 sectors."""
        outdir = generate_universe(sectors=500, seed=99, two_way_pct=0)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._check_strong_connectivity(warp_rows, 500,
                                        "500 sectors, two-way-pct=0: ")
        inbound = Counter(int(row[1]) for row in warp_rows)
        for sid in range(1, 501):
            count = inbound.get(sid, 0)
            self.assertGreaterEqual(count, 1,
                                    f"500 sectors, two-way-pct=0: Sector {sid} has "
                                    f"{count} inbound (min 1)")
            self.assertLessEqual(count, 6,
                                 f"500 sectors, two-way-pct=0: Sector {sid} has "
                                 f"{count} inbound (max 6)")
        shutil.rmtree(outdir)

    def test_all_warp_constraints_at_minimum_sectors(self):
        """At 20 sectors (minimum), all warp constraints must hold simultaneously."""
        num_sectors = 20
        for twp in [0, 50, 100]:
            outdir = generate_universe(sectors=num_sectors, seed=42, two_way_pct=twp)
            _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))

            # Strong connectivity
            self._check_strong_connectivity(warp_rows, num_sectors,
                                            f"20 sectors, two-way-pct={twp}: ")

            # Outbound and inbound limits
            outbound = Counter(int(row[0]) for row in warp_rows)
            inbound = Counter(int(row[1]) for row in warp_rows)
            for sid in range(1, num_sectors + 1):
                self.assertGreaterEqual(outbound.get(sid, 0), 1,
                                        f"20 sectors, twp={twp}: Sector {sid} "
                                        f"has {outbound.get(sid, 0)} outbound (min 1)")
                self.assertLessEqual(outbound.get(sid, 0), 6,
                                     f"20 sectors, twp={twp}: Sector {sid} "
                                     f"has {outbound.get(sid, 0)} outbound (max 6)")
                self.assertGreaterEqual(inbound.get(sid, 0), 1,
                                        f"20 sectors, twp={twp}: Sector {sid} "
                                        f"has {inbound.get(sid, 0)} inbound (min 1)")
                self.assertLessEqual(inbound.get(sid, 0), 6,
                                     f"20 sectors, twp={twp}: Sector {sid} "
                                     f"has {inbound.get(sid, 0)} inbound (max 6)")

            # No self-warps, no duplicates
            pairs = [(row[0], row[1]) for row in warp_rows]
            self.assertEqual(len(pairs), len(set(pairs)),
                             f"20 sectors, twp={twp}: Duplicate warps detected")
            for row in warp_rows:
                self.assertNotEqual(row[0], row[1],
                                    f"20 sectors, twp={twp}: Self-warp in sector {row[0]}")

            # Bidirectional percentage
            warp_set = set((int(r[0]), int(r[1])) for r in warp_rows)
            bidi = sum(1 for (a, b) in warp_set if (b, a) in warp_set)
            total = len(warp_set)
            pct = (bidi / total * 100) if total > 0 else 0
            low = max(0.0, twp - 1.0)
            high = min(100.0, twp + 1.0)
            self.assertGreaterEqual(pct, low,
                                    f"20 sectors, twp={twp}: bidirectional {pct:.1f}% "
                                    f"below [{low}-{high}%]")
            self.assertLessEqual(pct, high,
                                 f"20 sectors, twp={twp}: bidirectional {pct:.1f}% "
                                 f"above [{low}-{high}%]")

            shutil.rmtree(outdir)


# ============================================================================
# BIDIRECTIONAL WARP PERCENTAGE
# ============================================================================

class TestBidirectionalWarps(unittest.TestCase):
    """Tests for the --two-way-pct parameter controlling bidirectional warp ratio."""

    def _assert_two_way_pct_in_range(self, warp_rows, target, label=""):
        """Assert bidirectional warp % is within ±1 percentage point of target."""
        _, total, actual_pct = compute_bidirectional_pct(warp_rows)
        low = max(0.0, target - 1.0)
        high = min(100.0, target + 1.0)
        self.assertGreaterEqual(actual_pct, low,
                                f"{label}Bidirectional warp % is {actual_pct:.1f}%, "
                                f"expected [{low:.0f}%-{high:.0f}%] for target {target}%")
        self.assertLessEqual(actual_pct, high,
                             f"{label}Bidirectional warp % is {actual_pct:.1f}%, "
                             f"expected [{low:.0f}%-{high:.0f}%] for target {target}%")

    def test_two_way_pct_default_90(self):
        """Default --two-way-pct (90) should yield 89%-91% bidirectional warps."""
        outdir = generate_universe(sectors=100, seed=42)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._assert_two_way_pct_in_range(warp_rows, 90, "Default: ")
        shutil.rmtree(outdir)

    def test_two_way_pct_0(self):
        """--two-way-pct 0 should yield 0%-1% bidirectional warps."""
        outdir = generate_universe(sectors=100, seed=42, two_way_pct=0)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._assert_two_way_pct_in_range(warp_rows, 0, "two-way-pct=0: ")
        shutil.rmtree(outdir)

    def test_two_way_pct_100(self):
        """--two-way-pct 100 should yield 99%-100% bidirectional warps."""
        outdir = generate_universe(sectors=100, seed=42, two_way_pct=100)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._assert_two_way_pct_in_range(warp_rows, 100, "two-way-pct=100: ")
        shutil.rmtree(outdir)

    def test_two_way_pct_50(self):
        """--two-way-pct 50 should yield 49%-51% bidirectional warps."""
        outdir = generate_universe(sectors=100, seed=42, two_way_pct=50)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._assert_two_way_pct_in_range(warp_rows, 50, "two-way-pct=50: ")
        shutil.rmtree(outdir)

    def test_two_way_pct_20(self):
        """--two-way-pct 20 should yield 19%-21% bidirectional warps."""
        outdir = generate_universe(sectors=100, seed=42, two_way_pct=20)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        self._assert_two_way_pct_in_range(warp_rows, 20, "two-way-pct=20: ")
        shutil.rmtree(outdir)

    def test_low_two_way_produces_fewer_than_high(self):
        """--two-way-pct 10 should produce fewer bidirectional warps than 90."""
        outdir_low = generate_universe(sectors=100, seed=42, two_way_pct=10)
        outdir_high = generate_universe(sectors=100, seed=42, two_way_pct=90)
        _, warp_rows_low = read_csv_file(os.path.join(outdir_low, "warps.csv"))
        _, warp_rows_high = read_csv_file(os.path.join(outdir_high, "warps.csv"))
        _, _, pct_low = compute_bidirectional_pct(warp_rows_low)
        _, _, pct_high = compute_bidirectional_pct(warp_rows_high)
        self.assertLess(pct_low, pct_high,
                        f"two-way-pct=10 gave {pct_low:.1f}% bidirectional but "
                        f"two-way-pct=90 gave {pct_high:.1f}% — low should be less")
        shutil.rmtree(outdir_low)
        shutil.rmtree(outdir_high)

    def test_two_way_pct_0_still_strongly_connected(self):
        """Even with --two-way-pct 0, the graph must remain strongly connected."""
        outdir = generate_universe(sectors=100, seed=42, two_way_pct=0)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        adj = defaultdict(set)
        for row in warp_rows:
            adj[int(row[0])].add(int(row[1]))

        all_sectors = set(range(1, 101))

        visited = set()
        queue = [1]
        visited.add(1)
        while queue:
            current = queue.pop(0)
            for neighbor in adj[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        self.assertEqual(visited, all_sectors,
                         f"Forward BFS reached {len(visited)}/100 with two-way-pct=0")

        rev_adj = defaultdict(set)
        for row in warp_rows:
            rev_adj[int(row[1])].add(int(row[0]))
        visited_rev = set()
        queue = [1]
        visited_rev.add(1)
        while queue:
            current = queue.pop(0)
            for neighbor in rev_adj[current]:
                if neighbor not in visited_rev:
                    visited_rev.add(neighbor)
                    queue.append(neighbor)
        self.assertEqual(visited_rev, all_sectors,
                         f"Reverse BFS reached {len(visited_rev)}/100 with two-way-pct=0")
        shutil.rmtree(outdir)

    def test_two_way_pct_100_still_respects_degree_limits(self):
        """Even with --two-way-pct 100, no sector should exceed 6 outbound or 6 inbound warps."""
        outdir = generate_universe(sectors=100, seed=42, two_way_pct=100)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        outbound = Counter(int(row[0]) for row in warp_rows)
        inbound = Counter(int(row[1]) for row in warp_rows)
        for sid in range(1, 101):
            self.assertLessEqual(outbound.get(sid, 0), 6,
                                 f"Sector {sid} has {outbound.get(sid, 0)} outbound warps "
                                 f"with two-way-pct=100 (max 6)")
            self.assertLessEqual(inbound.get(sid, 0), 6,
                                 f"Sector {sid} has {inbound.get(sid, 0)} inbound warps "
                                 f"with two-way-pct=100 (max 6)")
        shutil.rmtree(outdir)

    def test_two_way_pct_0_still_respects_degree_limits(self):
        """Even with --two-way-pct 0, no sector should exceed 6 inbound warps."""
        outdir = generate_universe(sectors=200, seed=42, two_way_pct=0)
        _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))
        inbound = Counter(int(row[1]) for row in warp_rows)
        for sid in range(1, 201):
            count = inbound.get(sid, 0)
            self.assertGreaterEqual(count, 1,
                                    f"Sector {sid} has {count} inbound warps "
                                    f"with two-way-pct=0 (min 1)")
            self.assertLessEqual(count, 6,
                                 f"Sector {sid} has {count} inbound warps "
                                 f"with two-way-pct=0 (max 6)")
        shutil.rmtree(outdir)

    def test_two_way_pct_at_scale_1000_sectors(self):
        """At 1000 sectors, --two-way-pct must still hit the ±1% window and all constraints."""
        num_sectors = 1000
        for target in [10, 50, 90]:
            outdir = generate_universe(sectors=num_sectors, seed=42, two_way_pct=target)
            _, warp_rows = read_csv_file(os.path.join(outdir, "warps.csv"))

            # Check bidirectional percentage within ±1%
            self._assert_two_way_pct_in_range(
                warp_rows, target, f"1000 sectors, target={target}: ")

            # Check outbound and inbound limits
            outbound = Counter(int(row[0]) for row in warp_rows)
            inbound = Counter(int(row[1]) for row in warp_rows)
            for sid in range(1, num_sectors + 1):
                self.assertGreaterEqual(outbound.get(sid, 0), 1,
                                        f"Sector {sid} has 0 outbound warps at "
                                        f"1000 sectors, two-way-pct={target}")
                self.assertLessEqual(outbound.get(sid, 0), 6,
                                     f"Sector {sid} has {outbound.get(sid, 0)} outbound warps at "
                                     f"1000 sectors, two-way-pct={target}")
                self.assertGreaterEqual(inbound.get(sid, 0), 1,
                                        f"Sector {sid} has 0 inbound warps at "
                                        f"1000 sectors, two-way-pct={target}")
                self.assertLessEqual(inbound.get(sid, 0), 6,
                                     f"Sector {sid} has {inbound.get(sid, 0)} inbound warps at "
                                     f"1000 sectors, two-way-pct={target}")

            # Check strong connectivity
            adj = defaultdict(set)
            for row in warp_rows:
                adj[int(row[0])].add(int(row[1]))
            all_sectors = set(range(1, num_sectors + 1))
            visited = set()
            queue = [1]
            visited.add(1)
            while queue:
                current = queue.pop(0)
                for neighbor in adj[current]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        queue.append(neighbor)
            self.assertEqual(visited, all_sectors,
                             f"Forward BFS only reached {len(visited)}/{num_sectors} "
                             f"at two-way-pct={target}")

            shutil.rmtree(outdir)


# ============================================================================
# PORT GENERATION
# ============================================================================

class TestPortGeneration(unittest.TestCase):
    """Tests for port generation rules."""

    @classmethod
    def setUpClass(cls):
        cls.num_sectors = 200
        cls.port_density = 60
        cls.outdir = generate_universe(
            sectors=cls.num_sectors, seed=42,
            port_density=cls.port_density, planet_density=10
        )
        cls.header, cls.rows = read_csv_file(os.path.join(cls.outdir, "ports.csv"))
        s_header, s_rows = read_csv_file(os.path.join(cls.outdir, "sectors.csv"))
        cls.stardock_sector = None
        for row in s_rows:
            if row[1] == "Stardock":
                cls.stardock_sector = int(row[0])
                break

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_ports_csv_header(self):
        """ports.csv must have exact header columns."""
        self.assertEqual(
            self.header,
            ["sector", "class", "fuel_qty", "fuel_price", "org_qty", "org_price",
             "equ_qty", "equ_price"]
        )

    def test_port_classes_valid(self):
        """All port classes must be 1-8."""
        for row in self.rows:
            pc = int(row[1])
            self.assertIn(pc, range(1, 9), f"Invalid port class {pc} in sector {row[0]}")

    def test_port_class_distribution_roughly_uniform(self):
        """Port class distribution should be roughly uniform across 1-8."""
        classes = [int(row[1]) for row in self.rows]
        counts = Counter(classes)
        total = len(classes)
        if total >= 40:
            expected = total / 8
            for c in range(1, 9):
                count = counts.get(c, 0)
                self.assertGreaterEqual(count, expected * 0.25,
                                        f"Port class {c}: {count} ports, expected ~{expected:.0f}")
                self.assertLessEqual(count, expected * 2.5,
                                     f"Port class {c}: {count} ports, expected ~{expected:.0f}")

    def test_stardock_has_class_8_port(self):
        """The Stardock sector must have a class 8 port."""
        self.assertIsNotNone(self.stardock_sector, "Stardock sector not found")
        stardock_ports = [row for row in self.rows if int(row[0]) == self.stardock_sector]
        self.assertEqual(len(stardock_ports), 1, "Stardock must have exactly 1 port")
        self.assertEqual(int(stardock_ports[0][1]), 8, "Stardock port must be class 8")

    def test_sector_1_has_no_port(self):
        """Sector 1 (Federation Space) must not contain a port."""
        sector_1_ports = [row for row in self.rows if int(row[0]) == 1]
        self.assertEqual(len(sector_1_ports), 0, "Sector 1 must not have a port")

    def test_at_most_one_port_per_sector(self):
        """Each sector can have at most 1 port."""
        sector_counts = Counter(int(row[0]) for row in self.rows)
        for sector, count in sector_counts.items():
            self.assertLessEqual(count, 1,
                                 f"Sector {sector} has {count} ports (max 1)")

    def test_port_quantity_range(self):
        """All commodity quantities must be 0-5000."""
        for row in self.rows:
            for idx in [2, 4, 6]:
                qty = int(row[idx])
                self.assertGreaterEqual(qty, 0,
                                        f"Sector {row[0]}: quantity {qty} < 0")
                self.assertLessEqual(qty, 5000,
                                     f"Sector {row[0]}: quantity {qty} > 5000")

    def test_port_sell_prices_range(self):
        """For commodities the port sells, price should be 10-50."""
        for row in self.rows:
            pc = int(row[1])
            bsa = PORT_CLASSES[pc]
            price_indices = [3, 5, 7]
            for i, action in enumerate(bsa):
                price = int(row[price_indices[i]])
                if action == "S":
                    self.assertGreaterEqual(price, 10,
                                            f"Sector {row[0]} class {pc}: sell price {price} < 10")
                    self.assertLessEqual(price, 50,
                                         f"Sector {row[0]} class {pc}: sell price {price} > 50")

    def test_port_buy_prices_range(self):
        """For commodities the port buys, price should be 51-100."""
        for row in self.rows:
            pc = int(row[1])
            bsa = PORT_CLASSES[pc]
            price_indices = [3, 5, 7]
            for i, action in enumerate(bsa):
                price = int(row[price_indices[i]])
                if action == "B":
                    self.assertGreaterEqual(price, 51,
                                            f"Sector {row[0]} class {pc}: buy price {price} < 51")
                    self.assertLessEqual(price, 100,
                                         f"Sector {row[0]} class {pc}: buy price {price} > 100")

    def test_port_count_approximates_density(self):
        """Number of ports should approximately match port-density percentage."""
        eligible_sectors = self.num_sectors - 1
        expected = eligible_sectors * self.port_density / 100
        actual = len(self.rows)
        self.assertGreaterEqual(actual, expected * 0.5,
                                f"Too few ports: {actual}, expected around {expected}")
        self.assertLessEqual(actual, expected * 1.5,
                             f"Too many ports: {actual}, expected around {expected}")


# ============================================================================
# PLANET GENERATION
# ============================================================================

class TestPlanetGeneration(unittest.TestCase):
    """Tests for planet generation rules."""

    @classmethod
    def setUpClass(cls):
        cls.num_sectors = 200
        cls.planet_density = 30
        cls.outdir = generate_universe(
            sectors=cls.num_sectors, seed=42,
            port_density=50, planet_density=cls.planet_density
        )
        cls.header, cls.rows = read_csv_file(os.path.join(cls.outdir, "planets.csv"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_planets_csv_header(self):
        """planets.csv must have header: sector, planet_name, planet_type."""
        self.assertEqual(self.header, ["sector", "planet_name", "planet_type"])

    def test_valid_planet_types(self):
        """All planet types must be one of the valid types."""
        for row in self.rows:
            self.assertIn(row[2], VALID_PLANET_TYPES,
                          f"Invalid planet type '{row[2]}' in sector {row[0]}")

    def test_planet_type_distribution_roughly_uniform(self):
        """Planet type distribution should be roughly uniform."""
        types = [row[2] for row in self.rows]
        counts = Counter(types)
        total = len(types)
        if total >= 25:
            expected = total / len(VALID_PLANET_TYPES)
            for pt in VALID_PLANET_TYPES:
                count = counts.get(pt, 0)
                self.assertGreaterEqual(count, expected * 0.25,
                                        f"Planet type '{pt}': {count}, expected ~{expected:.0f}")
                self.assertLessEqual(count, expected * 2.5,
                                     f"Planet type '{pt}': {count}, expected ~{expected:.0f}")

    def test_max_3_planets_per_sector(self):
        """Each sector can have at most 3 planets."""
        sector_counts = Counter(int(row[0]) for row in self.rows)
        for sector, count in sector_counts.items():
            self.assertLessEqual(count, 3,
                                 f"Sector {sector} has {count} planets (max 3)")

    def test_sector_1_has_no_planets(self):
        """Sector 1 must not contain any planets."""
        sector_1_planets = [row for row in self.rows if int(row[0]) == 1]
        self.assertEqual(len(sector_1_planets), 0, "Sector 1 must not have planets")

    def test_planet_name_format(self):
        """Planet names must follow '{planet_type}-{sector_id}-{index}' format."""
        sector_planets = defaultdict(list)
        for row in self.rows:
            sector_planets[int(row[0])].append(row)

        for sector, planets in sector_planets.items():
            indices_seen = []
            for row in planets:
                name = row[1]
                ptype = row[2]
                # Name must match format: {type}-{sector}-{index}
                expected_prefix = f"{ptype}-{sector}-"
                self.assertTrue(
                    name.startswith(expected_prefix),
                    f"Planet name '{name}' should start with '{expected_prefix}'"
                )
                # Extract and validate the index part
                suffix = name[len(expected_prefix):]
                self.assertTrue(suffix.isdigit(),
                                f"Planet name '{name}' index part '{suffix}' is not a number")
                indices_seen.append(int(suffix))

            # Indices should be 1..N with no gaps
            expected_indices = list(range(1, len(planets) + 1))
            self.assertEqual(
                sorted(indices_seen), expected_indices,
                f"Sector {sector}: planet indices {sorted(indices_seen)} "
                f"should be {expected_indices}"
            )

    def test_planet_sectors_in_range(self):
        """All planet sectors must be in range 1-N."""
        for row in self.rows:
            sid = int(row[0])
            self.assertGreaterEqual(sid, 1)
            self.assertLessEqual(sid, self.num_sectors)

    def test_planet_count_approximates_density(self):
        """Number of sectors with planets should approximately match density %."""
        eligible_sectors = self.num_sectors - 1
        expected = eligible_sectors * self.planet_density / 100
        sectors_with_planets = len(set(int(row[0]) for row in self.rows))
        self.assertGreaterEqual(sectors_with_planets, expected * 0.5,
                                f"Too few: {sectors_with_planets}, expected ~{expected}")
        self.assertLessEqual(sectors_with_planets, expected * 1.5,
                             f"Too many: {sectors_with_planets}, expected ~{expected}")

    def test_planet_counts_per_sector_varied(self):
        """Sectors with planets should have a mix of 1, 2, and 3 planets, not all the same."""
        sector_counts = Counter(int(row[0]) for row in self.rows)
        count_distribution = Counter(sector_counts.values())
        # count_distribution maps {1: how_many_sectors_with_1_planet, 2: ..., 3: ...}
        distinct_counts = set(count_distribution.keys())
        # With 200 sectors at 30% density, ~60 sectors have planets.
        # We should see at least 2 different planet-per-sector counts (e.g. some with 1, some with 2)
        self.assertGreaterEqual(len(distinct_counts), 2,
                                f"All planet-bearing sectors have the same count: "
                                f"{count_distribution}. Expected a mix of 1-3 planets per sector.")


# ============================================================================
# DENSITY BOUNDARIES
# ============================================================================

class TestDensityBoundaries(unittest.TestCase):
    """Tests for boundary values of density options."""

    def test_planet_density_zero_produces_no_planets(self):
        """--planet-density 0 should produce a planets.csv with only a header."""
        outdir = generate_universe(sectors=50, seed=99, port_density=50, planet_density=0)
        _, rows = read_csv_file(os.path.join(outdir, "planets.csv"))
        self.assertEqual(len(rows), 0,
                         f"Expected 0 planets with --planet-density 0, got {len(rows)}")
        shutil.rmtree(outdir)

    def test_planet_density_100_produces_planets(self):
        """--planet-density 100 should produce planets in all eligible sectors."""
        num_sectors = 50
        outdir = generate_universe(sectors=num_sectors, seed=99, port_density=50,
                                   planet_density=100)
        _, rows = read_csv_file(os.path.join(outdir, "planets.csv"))
        sectors_with_planets = set(int(row[0]) for row in rows)
        eligible = set(range(2, num_sectors + 1))
        self.assertEqual(sectors_with_planets, eligible,
                         f"Missing sectors with planets: {eligible - sectors_with_planets}")
        shutil.rmtree(outdir)

    def test_port_density_100_produces_ports_in_all_eligible(self):
        """--port-density 100 should produce ports in all eligible sectors."""
        num_sectors = 50
        outdir = generate_universe(sectors=num_sectors, seed=99, port_density=100,
                                   planet_density=5)
        _, rows = read_csv_file(os.path.join(outdir, "ports.csv"))
        sectors_with_ports = set(int(row[0]) for row in rows)
        eligible = set(range(2, num_sectors + 1))
        self.assertEqual(sectors_with_ports, eligible,
                         f"Missing sectors with ports: {eligible - sectors_with_ports}")
        shutil.rmtree(outdir)

    def test_low_port_density_produces_fewer_ports_than_high(self):
        """--port-density 10 should produce significantly fewer ports than 90."""
        num_sectors = 200
        outdir_low = generate_universe(sectors=num_sectors, seed=55, port_density=10,
                                       planet_density=5)
        outdir_high = generate_universe(sectors=num_sectors, seed=55, port_density=90,
                                        planet_density=5)
        _, rows_low = read_csv_file(os.path.join(outdir_low, "ports.csv"))
        _, rows_high = read_csv_file(os.path.join(outdir_high, "ports.csv"))
        self.assertLess(len(rows_low) * 2, len(rows_high),
                        f"10% ({len(rows_low)} ports) should be well below "
                        f"90% ({len(rows_high)} ports)")
        shutil.rmtree(outdir_low)
        shutil.rmtree(outdir_high)

    def test_low_planet_density_produces_fewer_planets_than_high(self):
        """--planet-density 5 should produce fewer planet-sectors than 80."""
        num_sectors = 200
        outdir_low = generate_universe(sectors=num_sectors, seed=55, port_density=50,
                                       planet_density=5)
        outdir_high = generate_universe(sectors=num_sectors, seed=55, port_density=50,
                                        planet_density=80)
        _, rows_low = read_csv_file(os.path.join(outdir_low, "planets.csv"))
        _, rows_high = read_csv_file(os.path.join(outdir_high, "planets.csv"))
        sectors_low = len(set(int(row[0]) for row in rows_low))
        sectors_high = len(set(int(row[0]) for row in rows_high))
        self.assertLess(sectors_low * 2, sectors_high,
                        f"5% ({sectors_low} sectors) should be well below "
                        f"80% ({sectors_high} sectors)")
        shutil.rmtree(outdir_low)
        shutil.rmtree(outdir_high)

    def test_port_density_10_approximates_10_percent(self):
        """--port-density 10 should produce roughly 10% ports in eligible sectors."""
        num_sectors = 200
        outdir = generate_universe(sectors=num_sectors, seed=77, port_density=10,
                                   planet_density=5)
        _, rows = read_csv_file(os.path.join(outdir, "ports.csv"))
        eligible = num_sectors - 1
        expected = eligible * 10 / 100
        actual = len(rows)
        self.assertGreaterEqual(actual, expected * 0.4,
                                f"port-density 10: got {actual}, expected ~{expected:.0f}")
        self.assertLessEqual(actual, expected * 2.0,
                             f"port-density 10: got {actual}, expected ~{expected:.0f}")
        shutil.rmtree(outdir)

    def test_planet_density_50_approximates_50_percent(self):
        """--planet-density 50 should produce planets in ~50% of eligible sectors."""
        num_sectors = 200
        outdir = generate_universe(sectors=num_sectors, seed=77, port_density=50,
                                   planet_density=50)
        _, rows = read_csv_file(os.path.join(outdir, "planets.csv"))
        eligible = num_sectors - 1
        expected = eligible * 50 / 100
        sectors_with_planets = len(set(int(row[0]) for row in rows))
        self.assertGreaterEqual(sectors_with_planets, expected * 0.5,
                                f"planet-density 50: got {sectors_with_planets}, "
                                f"expected ~{expected:.0f}")
        self.assertLessEqual(sectors_with_planets, expected * 1.5,
                             f"planet-density 50: got {sectors_with_planets}, "
                             f"expected ~{expected:.0f}")
        shutil.rmtree(outdir)


# ============================================================================
# REFERENTIAL INTEGRITY
# ============================================================================

class TestReferentialIntegrity(unittest.TestCase):
    """Tests that data across CSV files is internally consistent."""

    @classmethod
    def setUpClass(cls):
        cls.num_sectors = 100
        cls.outdir = generate_universe(
            sectors=cls.num_sectors, seed=42,
            port_density=60, planet_density=30
        )
        _, cls.sector_rows = read_csv_file(os.path.join(cls.outdir, "sectors.csv"))
        _, cls.warp_rows = read_csv_file(os.path.join(cls.outdir, "warps.csv"))
        _, cls.port_rows = read_csv_file(os.path.join(cls.outdir, "ports.csv"))
        _, cls.planet_rows = read_csv_file(os.path.join(cls.outdir, "planets.csv"))
        cls.valid_sector_ids = set(int(row[0]) for row in cls.sector_rows)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_warp_from_sectors_exist(self):
        """Every sector_from in warps.csv must exist in sectors.csv."""
        for row in self.warp_rows:
            self.assertIn(int(row[0]), self.valid_sector_ids,
                          f"Warp references non-existent source sector {row[0]}")

    def test_warp_to_sectors_exist(self):
        """Every sector_to in warps.csv must exist in sectors.csv."""
        for row in self.warp_rows:
            self.assertIn(int(row[1]), self.valid_sector_ids,
                          f"Warp references non-existent destination sector {row[1]}")

    def test_port_sectors_exist(self):
        """Every sector in ports.csv must exist in sectors.csv."""
        for row in self.port_rows:
            self.assertIn(int(row[0]), self.valid_sector_ids,
                          f"Port references non-existent sector {row[0]}")

    def test_planet_sectors_exist(self):
        """Every sector in planets.csv must exist in sectors.csv."""
        for row in self.planet_rows:
            self.assertIn(int(row[0]), self.valid_sector_ids,
                          f"Planet references non-existent sector {row[0]}")

    def test_sql_csv_data_consistency(self):
        """import.sql should reference the same CSV filenames that were generated."""
        with open(os.path.join(self.outdir, "import.sql"), "r") as f:
            sql = f.read()
        for csv_name in ["sectors.csv", "warps.csv", "ports.csv", "planets.csv"]:
            self.assertIn(csv_name, sql,
                          f"import.sql should reference {csv_name}")


# ============================================================================
# IMPORT SQL
# ============================================================================

class TestImportSQL(unittest.TestCase):
    """Tests for the import.sql PostgreSQL file."""

    @classmethod
    def setUpClass(cls):
        cls.outdir = generate_universe(sectors=50, seed=42)
        with open(os.path.join(cls.outdir, "import.sql"), "r") as f:
            cls.sql = f.read()
        cls.sql_stripped = cls.sql.strip()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def test_begins_with_begin(self):
        """import.sql must begin with BEGIN;"""
        self.assertTrue(
            self.sql_stripped.startswith("BEGIN;"),
            f"Starts with: '{self.sql_stripped[:50]}'"
        )

    def test_ends_with_commit(self):
        """import.sql must end with COMMIT;"""
        self.assertTrue(
            self.sql_stripped.endswith("COMMIT;"),
            f"Ends with: '{self.sql_stripped[-50:]}'"
        )

    def test_create_table_sectors(self):
        pattern = re.compile(r"CREATE\s+TABLE\s+sectors\s*\(", re.IGNORECASE)
        self.assertRegex(self.sql, pattern, "Missing CREATE TABLE sectors")

    def test_create_table_warps(self):
        pattern = re.compile(r"CREATE\s+TABLE\s+warps\s*\(", re.IGNORECASE)
        self.assertRegex(self.sql, pattern, "Missing CREATE TABLE warps")

    def test_create_table_ports(self):
        pattern = re.compile(r"CREATE\s+TABLE\s+ports\s*\(", re.IGNORECASE)
        self.assertRegex(self.sql, pattern, "Missing CREATE TABLE ports")

    def test_create_table_planets(self):
        pattern = re.compile(r"CREATE\s+TABLE\s+planets\s*\(", re.IGNORECASE)
        self.assertRegex(self.sql, pattern, "Missing CREATE TABLE planets")

    def test_copy_statements_exist(self):
        r"""import.sql must contain \copy statements for each CSV."""
        for table in ["sectors", "warps", "ports", "planets"]:
            pattern = re.compile(r"\\copy\s+" + table, re.IGNORECASE)
            self.assertRegex(self.sql, pattern,
                             f"Missing \\copy statement for {table}")

    def test_copy_uses_relative_paths(self):
        r"""\\copy statements must use relative paths."""
        copy_lines = [line for line in self.sql.split("\n")
                      if line.strip().lower().startswith("\\copy")]
        for line in copy_lines:
            csv_match = re.search(r"FROM\s+'([^']+)'", line, re.IGNORECASE)
            if csv_match:
                path = csv_match.group(1)
                self.assertFalse(path.startswith("/"),
                                 f"\\copy path should be relative, got: {path}")

    def test_sql_has_integer_columns(self):
        """CREATE TABLE statements should use INTEGER for numeric columns."""
        sql_upper = self.sql.upper()
        self.assertTrue(
            "INTEGER" in sql_upper or "INT " in sql_upper or "INT," in sql_upper,
            "SQL should use INTEGER type for numeric columns"
        )

    def test_sql_has_text_columns(self):
        """CREATE TABLE statements should use VARCHAR or TEXT for string columns."""
        sql_upper = self.sql.upper()
        self.assertTrue(
            "VARCHAR" in sql_upper or "TEXT" in sql_upper,
            "SQL should use VARCHAR or TEXT for string columns"
        )


# ============================================================================
# CSV FORMATTING
# ============================================================================

class TestCSVFormatting(unittest.TestCase):
    """Tests for CSV formatting requirements."""

    @classmethod
    def setUpClass(cls):
        cls.outdir = generate_universe(sectors=50, seed=42, port_density=50,
                                       planet_density=20)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.outdir)

    def _check_csv_comma_delimited(self, filename):
        filepath = os.path.join(self.outdir, filename)
        with open(filepath, "r") as f:
            first_line = f.readline().strip()
        self.assertIn(",", first_line, f"{filename} should use comma delimiters")

    def test_sectors_csv_comma_delimited(self):
        self._check_csv_comma_delimited("sectors.csv")

    def test_warps_csv_comma_delimited(self):
        self._check_csv_comma_delimited("warps.csv")

    def test_ports_csv_comma_delimited(self):
        self._check_csv_comma_delimited("ports.csv")

    def test_planets_csv_comma_delimited(self):
        self._check_csv_comma_delimited("planets.csv")

    def test_sectors_csv_header_first_line(self):
        filepath = os.path.join(self.outdir, "sectors.csv")
        with open(filepath, "r") as f:
            self.assertEqual(f.readline().strip(), "id,name")

    def test_warps_csv_header_first_line(self):
        filepath = os.path.join(self.outdir, "warps.csv")
        with open(filepath, "r") as f:
            self.assertEqual(f.readline().strip(), "sector_from,sector_to")

    def test_ports_csv_header_first_line(self):
        filepath = os.path.join(self.outdir, "ports.csv")
        with open(filepath, "r") as f:
            self.assertEqual(
                f.readline().strip(),
                "sector,class,fuel_qty,fuel_price,org_qty,org_price,equ_qty,equ_price"
            )

    def test_planets_csv_header_first_line(self):
        filepath = os.path.join(self.outdir, "planets.csv")
        with open(filepath, "r") as f:
            self.assertEqual(f.readline().strip(), "sector,planet_name,planet_type")

    def test_csv_no_unnecessary_quoting(self):
        """CSV files should not quote fields unless the field contains a comma."""
        for fname in ["sectors.csv", "warps.csv", "ports.csv", "planets.csv"]:
            filepath = os.path.join(self.outdir, fname)
            with open(filepath, "r") as f:
                raw_content = f.read()
            for line_num, line in enumerate(raw_content.strip().split("\n"), 1):
                for field in re.findall(r'"([^"]*)"', line):
                    self.assertIn(",", field,
                                  f"{fname} line {line_num}: field '{field}' is quoted "
                                  f"but does not contain a comma")


if __name__ == "__main__":
    unittest.main()
