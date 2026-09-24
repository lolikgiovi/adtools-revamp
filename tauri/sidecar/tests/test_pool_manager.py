import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from oracle_sidecar import ConnectionConfig, PoolManager, TestConnectionRequest, test_connection


class FakePool:
    def __init__(self):
        self.busy = 0
        self.closed = False

    def close(self):
        self.closed = True


class PoolManagerTests(unittest.TestCase):
    def config(self, name, dsn):
        return ConnectionConfig(name=name, connect_string=dsn, username="user", password="password")

    def test_limits_active_names_and_releases_a_slot_on_disconnect(self):
        manager = PoolManager()
        pools = []

        def create_pool(**_kwargs):
            pool = FakePool()
            pools.append(pool)
            return pool

        with patch("oracle_sidecar.oracledb.create_pool", side_effect=create_pool):
            manager.get_pool(self.config("U81", "db-one"))
            manager.get_pool(self.config("U82", "db-two"))
            with self.assertRaisesRegex(ValueError, "Two Oracle connections"):
                manager.get_pool(self.config("U83", "db-three"))
            self.assertTrue(manager.disconnect_name("U81"))
            self.assertTrue(pools[0].closed)
            manager.get_pool(self.config("U83", "db-three"))
            self.assertTrue(manager.is_connected("U83"))

    def test_shared_pool_stays_open_until_last_name_disconnects(self):
        manager = PoolManager()
        pool = FakePool()
        with patch("oracle_sidecar.oracledb.create_pool", return_value=pool):
            manager.get_pool(self.config("U81", "shared-db"))
            manager.get_pool(self.config("U82", "shared-db"))
            self.assertTrue(manager.disconnect_name("U81"))
            self.assertFalse(pool.closed)
            self.assertTrue(manager.is_connected("U82"))
            self.assertTrue(manager.disconnect_name("U82"))
            self.assertTrue(pool.closed)

    def test_busy_pool_cannot_be_disconnected(self):
        manager = PoolManager()
        pool = FakePool()
        with patch("oracle_sidecar.oracledb.create_pool", return_value=pool):
            manager.get_pool(self.config("U81", "db-one"))
            pool.busy = 1
            with self.assertRaisesRegex(ValueError, "running a query"):
                manager.disconnect_name("U81")
            self.assertTrue(manager.is_connected("U81"))


class ConnectionCheckTests(unittest.IsolatedAsyncioTestCase):
    async def test_check_closes_transient_connection_without_creating_pool(self):
        class FakeCursor:
            def execute(self, sql):
                self.sql = sql

            def fetchone(self):
                return (1,)

        class FakeConnection:
            def __init__(self):
                self.closed = False
                self.cursor_instance = FakeCursor()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                self.closed = True

            def cursor(self):
                return self.cursor_instance

        connection = FakeConnection()
        request = TestConnectionRequest(connection=ConnectionConfig(
            name="U81", connect_string="db-one", username="user", password="password"
        ))
        with patch("oracle_sidecar.oracledb.connect", return_value=connection), patch(
            "oracle_sidecar.pool_manager.get_pool", side_effect=AssertionError("pool created")
        ):
            response = await test_connection(request)
        self.assertTrue(response["success"])
        self.assertEqual(connection.cursor_instance.sql, "SELECT 1 FROM DUAL")
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
