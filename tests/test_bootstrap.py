"""The upgrade from the v1 schema (projects with a `status` string and no categories)."""

from sqlalchemy import create_engine, inspect, text

from backend.bootstrap import init_db

V1_SCHEMA = """
CREATE TABLE projects (
    id VARCHAR NOT NULL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(9) NOT NULL,
    icon VARCHAR(40) NOT NULL,
    status VARCHAR(10) NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at DATETIME NOT NULL
)
"""


def v1_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'v1.db'}")
    with engine.begin() as conn:
        conn.execute(text(V1_SCHEMA))
        for pid, status in (("p1", "active"), ("p2", "done"), ("p3", "active")):
            conn.execute(
                text("INSERT INTO projects VALUES (:id, :id, '#2f5d8a', 'code', :status, 1, '2026-01-01')"),
                {"id": pid, "status": status},
            )
    return engine


def test_v1_projects_keep_their_status(tmp_path):
    engine = v1_database(tmp_path)
    init_db(engine)

    columns = {c["name"] for c in inspect(engine).get_columns("projects")}
    assert {"status_id", "notes", "skipped_at", "archived_at"} <= columns
    assert "status" not in columns

    with engine.connect() as conn:
        statuses = {name: (sid, done) for sid, name, done in conn.execute(text("SELECT id, name, is_done FROM statuses"))}
        assert set(statuses) == {"Active", "Done"} and statuses["Done"][1] == 1
        rows = dict(conn.execute(text("SELECT id, status_id FROM projects")).all())
    assert rows == {"p1": statuses["Active"][0], "p2": statuses["Done"][0], "p3": statuses["Active"][0]}


def test_upgrade_is_repeatable_and_leaves_new_projects_working(tmp_path):
    engine = v1_database(tmp_path)
    init_db(engine)
    init_db(engine)  # a second start changes nothing

    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM statuses")).scalar() == 2
        assert conn.execute(text("SELECT COUNT(*) FROM projects")).scalar() == 3

    # The old NOT NULL `status` column is gone, so inserting a v2 project works
    with engine.begin() as conn:
        status_id = conn.execute(text("SELECT id FROM statuses WHERE name = 'Active'")).scalar()
        conn.execute(
            text("INSERT INTO projects (id, name, color, icon, status_id, sort_order, created_at) "
                 "VALUES ('p4', 'New', '#2f5d8a', 'code', :s, 2, '2026-02-01')"),
            {"s": status_id},
        )


def test_fresh_database_gets_default_statuses(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    init_db(engine)
    with engine.connect() as conn:
        names = [r[0] for r in conn.execute(text("SELECT name FROM statuses ORDER BY sort_order"))]
    assert names == ["Active", "Done"]


def test_todos_made_before_completed_at_keep_working(tmp_path):
    """A database whose todos table predates completed_at gets the column; old rows stay NULL."""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-todos.db'}")
    init_db(engine)
    with engine.begin() as conn:
        status_id = conn.execute(text("SELECT id FROM statuses WHERE name = 'Active'")).scalar()
        conn.execute(
            text("INSERT INTO projects (id, name, color, icon, status_id, sort_order, created_at) "
                 "VALUES ('p1', 'New', '#2f5d8a', 'code', :s, 1, '2026-02-01')"),
            {"s": status_id},
        )
        conn.execute(text("DROP TABLE todos"))
        conn.execute(text(
            "CREATE TABLE todos (id VARCHAR NOT NULL PRIMARY KEY, project_id VARCHAR NOT NULL REFERENCES projects(id) "
            "ON DELETE CASCADE, text VARCHAR(200) NOT NULL, done BOOLEAN NOT NULL, sort_order INTEGER NOT NULL, "
            "created_at DATETIME NOT NULL)"
        ))
        conn.execute(text("INSERT INTO todos VALUES ('t1', 'p1', 'Old one', 1, 1, '2026-02-02')"))

    init_db(engine)
    init_db(engine)  # repeatable

    assert "completed_at" in {c["name"] for c in inspect(engine).get_columns("todos")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT done, completed_at FROM todos WHERE id = 't1'")).one() == (1, None)


def test_projects_made_before_skipped_at_keep_working(tmp_path):
    """A database whose projects table predates skipped_at gets the column; old rows stay NULL (never skipped)."""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-projects.db'}")
    init_db(engine)
    with engine.begin() as conn:
        status_id = conn.execute(text("SELECT id FROM statuses WHERE name = 'Active'")).scalar()
        conn.execute(
            text("INSERT INTO projects (id, name, color, icon, status_id, sort_order, created_at) "
                 "VALUES ('p1', 'Old', '#2f5d8a', 'code', :s, 1, '2026-02-01')"),
            {"s": status_id},
        )
        conn.execute(text("ALTER TABLE projects DROP COLUMN skipped_at"))

    init_db(engine)
    init_db(engine)  # repeatable

    assert "skipped_at" in {c["name"] for c in inspect(engine).get_columns("projects")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT skipped_at FROM projects WHERE id = 'p1'")).scalar() is None


def test_projects_made_before_archived_at_keep_working(tmp_path):
    """A database whose projects table predates archived_at gets the column; old rows stay NULL (on the board)."""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-projects-archive.db'}")
    init_db(engine)
    with engine.begin() as conn:
        status_id = conn.execute(text("SELECT id FROM statuses WHERE name = 'Active'")).scalar()
        conn.execute(
            text("INSERT INTO projects (id, name, color, icon, status_id, sort_order, created_at) "
                 "VALUES ('p1', 'Old', '#2f5d8a', 'code', :s, 1, '2026-02-01')"),
            {"s": status_id},
        )
        conn.execute(text("ALTER TABLE projects DROP COLUMN archived_at"))

    init_db(engine)
    init_db(engine)  # repeatable

    assert "archived_at" in {c["name"] for c in inspect(engine).get_columns("projects")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT archived_at FROM projects WHERE id = 'p1'")).scalar() is None


def test_interim_schema_with_a_category_column_still_works(tmp_path):
    """A database that ran the short-lived categories version keeps its unused category_id column."""
    engine = create_engine(f"sqlite:///{tmp_path / 'interim.db'}")
    init_db(engine)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE categories (id VARCHAR PRIMARY KEY, name VARCHAR(40))"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN category_id VARCHAR REFERENCES categories(id)"))
    init_db(engine)
    with engine.begin() as conn:
        status_id = conn.execute(text("SELECT id FROM statuses WHERE name = 'Active'")).scalar()
        conn.execute(
            text("INSERT INTO projects (id, name, color, icon, status_id, sort_order, created_at) "
                 "VALUES ('p1', 'New', '#2f5d8a', 'code', :s, 1, '2026-02-01')"),
            {"s": status_id},
        )


def test_pomodoros_made_before_completed_keep_working(tmp_path):
    """A database whose pomodoros table predates `completed` gets the column; old rows count as finished."""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-pomodoros.db'}")
    init_db(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE pomodoros"))
        conn.execute(text(
            "CREATE TABLE pomodoros (id VARCHAR NOT NULL PRIMARY KEY, start DATETIME NOT NULL, end DATETIME NOT NULL)"
        ))
        conn.execute(text("INSERT INTO pomodoros VALUES ('m1', '2026-02-02 10:00:00', '2026-02-02 10:25:00')"))

    init_db(engine)
    init_db(engine)  # repeatable

    with engine.connect() as conn:
        assert conn.execute(text("SELECT completed FROM pomodoros WHERE id = 'm1'")).scalar() == 1
