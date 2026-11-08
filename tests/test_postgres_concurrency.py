"""Real PostgreSQL concurrency regression, using an isolated disposable container.

Requires a local Docker daemon and the official postgres:17 image (pulled if
missing). No Supabase credentials, external database, or real notes are used.
Two psql connections contend while a third observes PostgreSQL's lock wait;
there are no timing-based guesses about which request overlaps another.
"""
import json
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import Thread
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = os.environ.get('POSTGRES_TEST_IMAGE', 'postgres:17')
ENV = os.environ.copy()
for selector in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS',
                 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
    ENV.pop(selector, None)
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
NAME = 'ass26-atomic-qa-' + uuid.uuid4().hex[:12]
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'atomic_test']
REPORT = []


def docker(*args, timeout=30):
    return subprocess.run(DOCKER + list(args), env=ENV, check=True,
                          text=True, capture_output=True, timeout=timeout).stdout.strip()


def sql(statement):
    return docker('exec', NAME, *PSQL, '-c', statement)


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def scope(account='synthetic-a', week='ca-copgm27', kind='ass26:programacao'):
    return ' AND '.join(f'{key}={quote(value)}' for key, value in
                        [('usuario_id', account), ('semana', week), ('tipo', kind)])


def row(where=None):
    raw = sql('SELECT row_to_json(r) FROM (SELECT id,conteudo_html,xmin::text AS version '
              'FROM richtext_anotacoes WHERE ' + (where or scope()) + ') r;')
    return json.loads(raw) if raw else None


def update(content, version, where=None):
    return ('WITH changed AS (UPDATE richtext_anotacoes SET conteudo_html=' + quote(content)
            + ' WHERE ' + (where or scope()) + ' AND xmin=' + quote(version)
            + '::xid RETURNING id) SELECT count(*) FROM changed;')


def insert(content, account='synthetic-a', week='ca-copgm27', kind='ass26:programacao'):
    values = ','.join(quote(v) for v in [account, week, kind, content])
    return ('WITH created AS (INSERT INTO richtext_anotacoes '
            '(usuario_id,semana,tipo,conteudo_html) VALUES (' + values + ') '
            'ON CONFLICT (usuario_id,semana,tipo) DO NOTHING RETURNING id) '
            'SELECT count(*) FROM created;')


class Session:
    def __init__(self):
        self.name = 'ass26-qa-' + uuid.uuid4().hex[:12]
        self.output = Queue()
        self.process = subprocess.Popen(
            DOCKER + ['exec', '-i', '-e', 'PGAPPNAME=' + self.name,
                      '-e', 'PGOPTIONS=-c statement_timeout=15000 -c lock_timeout=15000',
                      NAME] + PSQL, env=ENV, text=True, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1)
        Thread(target=self._collect, daemon=True).start()

    def _collect(self):
        for line in self.process.stdout:
            self.output.put(line.rstrip('\n'))
        self.output.put(None)

    def send(self, statement):
        marker = 'done_' + uuid.uuid4().hex
        self.process.stdin.write(statement + '\n\\echo ' + marker + '\n')
        self.process.stdin.flush()
        return marker

    def receive(self, marker, timeout=18):
        lines, deadline = [], time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                line = self.output.get(timeout=max(.01, deadline-time.monotonic()))
            except Empty:
                break
            if line == marker:
                return lines
            if line is None:
                raise AssertionError('psql terminated: ' + '\n'.join(lines))
            if line:
                lines.append(line)
        raise AssertionError('Timed out waiting for PostgreSQL response: ' + '\n'.join(lines))

    def run(self, statement):
        return self.receive(self.send(statement))

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write('ROLLBACK;\n\\q\n')
                self.process.stdin.flush()
                self.process.communicate(timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait(timeout=3)


def race(winner_statement, contender_statement):
    """The contender must block, then recheck its predicate after winner commit."""
    first, second = Session(), Session()
    try:
        assert first.run('BEGIN; ' + winner_statement) == ['1']
        marker = second.send(contender_statement)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            waiting = sql("SELECT count(*) FROM pg_stat_activity WHERE application_name="
                          + quote(second.name) + " AND wait_event_type='Lock';")
            if waiting == '1':
                break
            time.sleep(.04)
        else:
            raise AssertionError('Contender did not reach the expected database lock')
        first.run('COMMIT;')
        assert second.receive(marker) == ['0'], 'Stale contender unexpectedly wrote a row'
    finally:
        first.close()
        second.close()


def check(name, action):
    action()
    REPORT.append(name)
    print('PASS', name, flush=True)


def main():
    docker('info', '--format', '{{.ServerVersion}}')
    docker('run', '--rm', '-d', '--network', 'none', '--name', NAME,
           '--tmpfs', '/var/lib/postgresql/data',
           '-e', 'POSTGRES_DB=atomic_test', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
           IMAGE, timeout=180)
    try:
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            try:
                if sql('SELECT 1') == '1':
                    break
            except subprocess.CalledProcessError:
                time.sleep(.1)
        else:
            raise AssertionError('PostgreSQL did not become ready')
        sql('CREATE TABLE richtext_anotacoes ('
            'id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,'
            'usuario_id text NOT NULL, semana varchar(20) NOT NULL,'
            'tipo varchar(20) NOT NULL, conteudo_html text NOT NULL,'
            'UNIQUE(usuario_id,semana,tipo));')
        print('PostgreSQL', sql('SHOW server_version'), flush=True)

        def update_race():
            assert sql(insert('initial')) == '1'
            before_a, before_b = row(), row()
            assert before_a == before_b
            race(update('winner', before_a['version']), update('loser', before_b['version']))
            after = row()
            assert after['conteudo_html'] == 'winner'
            assert after['version'] != before_a['version']
        check('same-version concurrent updates: one winner, stale writer rejected after lock wait', update_race)

        def creation_race():
            sql('TRUNCATE richtext_anotacoes')
            assert row() is None
            race(insert('first creator'), insert('second creator'))
            assert sql('SELECT count(*) FROM richtext_anotacoes') == '1'
            assert row()['conteudo_html'] == 'first creator'
        check('concurrent first insert: unique scope and DO NOTHING preserve one document', creation_race)

        def delete_race():
            before = row()
            race(update('{}', before['version']), update('stale note', before['version']))
            assert row()['conteudo_html'] == '{}'
        check('cloud deletion versus stale upload cannot resurrect cleared content', delete_race)

        def stale_delete():
            before = row()
            race(update('new note', before['version']), update('{}', before['version']))
            assert row()['conteudo_html'] == 'new note'
        check('a stale deletion cannot erase a newly committed note', stale_delete)

        def isolation():
            contexts = [('synthetic-b', 'ca-copgm27', 'ass26:programacao'),
                        ('synthetic-a', '02-11', 'ass26:richtext'),
                        ('synthetic-a', '02-11', 'ass26:sentinela')]
            for account, week, kind in contexts:
                assert sql(insert('separate', account, week, kind)) == '1'
                assert row(scope(account, week, kind))['conteudo_html'] == 'separate'
            first, second = Session(), Session()
            try:
                before, other = row(), row(scope(*contexts[0]))
                assert first.run('BEGIN; ' + update('held account A', before['version'])) == ['1']
                assert second.run(update('independent account B', other['version'], scope(*contexts[0]))) == ['1']
                first.run('COMMIT;')
            finally:
                first.close()
                second.close()
            assert row()['conteudo_html'] == 'held account A'
            assert row(scope(*contexts[0]))['conteudo_html'] == 'independent account B'
            for context in contexts[1:]:
                assert row(scope(*context))['conteudo_html'] == 'separate'
        check('account/week/type scope stays isolated and different documents do not share a row lock', isolation)

        def long_content():
            payload = 'synthetic long note ' * 10000
            current = row()
            # stdin, rather than command arguments or URL parameters, carries notes.
            session = Session()
            try:
                assert session.run(update(payload, current['version'])) == ['1']
            finally:
                session.close()
            assert row()['conteudo_html'] == payload
        check('large note CAS depends only on short xmin token, not note size', long_content)
        print(json.dumps({'database': 'PostgreSQL', 'checks': len(REPORT),
                          'contexts': ['programme', 'notes', 'watchtower'],
                          'productionDataAccessed': False}), flush=True)
    finally:
        docker('rm', '-f', NAME)


if __name__ == '__main__':
    main()
