"""Run browser tests against a disposable local API, never the configured database."""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='analytics-browser-audit-') as directory:
        frontend_origin = os.environ.get('BROWSER_AUDIT_ORIGIN', 'http://localhost:8080')
        os.environ.update({
            'NODE_ENV': 'test',
            'ALLOW_SERVER_WORKSPACE': 'true',
            'DATABASE_URL': f"sqlite+aiosqlite:///{Path(directory, 'audit.db').as_posix()}",
            'UPLOAD_PATH': str(Path(directory, 'uploads')),
            'JWT_SECRET': 'browser-audit-disposable-secret-at-least-32-characters',
            'PASSWORD_PEPPER': 'browser-audit-disposable-pepper',
            'CLIENT_ORIGIN': frontend_origin,
            'CORS_ORIGINS': f'{frontend_origin},http://localhost:8080,http://127.0.0.1:8080',
            'TRUSTED_HOSTS': 'localhost,127.0.0.1,test',
            'FORCE_HTTPS': 'false', 'DEV_AUTH_BYPASS': 'false',
            'RATE_LIMITING_DISABLED': 'true', 'REDIS_URL': '',
            'RATE_LIMIT_STORAGE_URL': '', 'AI_LAYOUT_ENABLED': 'false',
            'OPENAI_API_KEY': '',
        })
        from app.core.database import init_db, AsyncSessionLocal
        from app.core.security import hash_password
        from app.domain.models import User
        import uvicorn

        async def prepare():
            await init_db()
            async with AsyncSessionLocal() as session:
                session.add(User(email='e2e-admin@example.com', password=hash_password('e2e-admin-password-change-me'), name='Browser audit', role='ADMIN'))
                await session.commit()

        asyncio.run(prepare())
        uvicorn.run('app.main:app', host='127.0.0.1', port=5000)
