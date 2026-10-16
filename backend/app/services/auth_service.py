from typing import Tuple
import logging
from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool
from app.domain.models import User
from app.repositories.user_repository import UserRepository
from app.repositories.audit_repository import AuditLogRepository
from app.core.security import create_access_token, hash_password, verify_password_with_upgrade, dummy_password_hash
from app.domain.schemas import UserLoginRequest


class AuthService:
    def __init__(self, user_repo: UserRepository, audit_repo: AuditLogRepository):
        self.user_repo = user_repo
        self.audit_repo = audit_repo

    async def login(self, req: UserLoginRequest) -> Tuple[User, str]:
        email = req.email.lower().strip()
        user = await self.user_repo.get_by_email(email)
        # Both paths do a bcrypt check. Offload CPU work from the ASGI event loop.
        stored_hash = user.password if user else await run_in_threadpool(dummy_password_hash)
        password_valid, needs_upgrade = await run_in_threadpool(verify_password_with_upgrade, req.password, stored_hash)
        if not user or not password_valid:
            logging.getLogger(__name__).warning("Authentication failed")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        if needs_upgrade:
            user.password = await run_in_threadpool(hash_password, req.password)
            await self.user_repo.update(user)

        token = create_access_token({
            "id": user.id,
            "email": user.email,
            "role": user.role,
            "ver": user.tokenVersion,
        })
        await self.audit_repo.log_action("LOGIN", user_id=user.id, details={"email": user.email})
        return user, token
