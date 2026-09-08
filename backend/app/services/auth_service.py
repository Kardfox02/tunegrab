from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User


password_hasher = PasswordHasher()


class AuthError(Exception):
    """Base class for expected authentication failures."""


class InvalidCredentialsError(AuthError):
    """Credentials are invalid."""


class UsernameTakenError(AuthError):
    """The username is already registered."""


class AuthService:
    async def register(self, session: AsyncSession, username: str, password: str) -> User:
        existing = await session.scalar(select(User).where(User.username == username))
        if existing is not None:
            raise UsernameTakenError

        user = User(username=username, password_hash=password_hasher.hash(password))
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user

    async def authenticate(self, session: AsyncSession, username: str, password: str) -> User:
        user = await session.scalar(select(User).where(User.username == username))
        if user is None:
            raise InvalidCredentialsError
        try:
            password_hasher.verify(user.password_hash, password)
        except (VerifyMismatchError, VerificationError):
            raise InvalidCredentialsError from None
        return user

    @staticmethod
    def create_token(user: User) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(user.id),
            "token_version": user.token_version,
            "iat": now,
            "exp": now + timedelta(seconds=settings.auth_ttl_seconds),
        }
        return jwt.encode(payload, settings.secret_key, algorithm="HS256")

    @staticmethod
    def decode_token(token: str) -> dict:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"])

    async def get_authenticated_user(self, session: AsyncSession, token: str) -> User:
        try:
            payload = self.decode_token(token)
            user_id = int(payload["sub"])
            token_version = int(payload["token_version"])
        except (ValueError, KeyError, TypeError, jwt.InvalidTokenError) as error:
            raise InvalidCredentialsError from error

        user = await session.get(User, user_id)
        if user is None or user.token_version != token_version:
            raise InvalidCredentialsError
        return user

    async def change_password(
        self,
        session: AsyncSession,
        user: User,
        current_password: str,
        new_password: str,
    ) -> User:
        try:
            password_hasher.verify(user.password_hash, current_password)
        except (VerifyMismatchError, VerificationError):
            raise InvalidCredentialsError from None
        user.password_hash = password_hasher.hash(new_password)
        user.token_version += 1
        await session.commit()
        await session.refresh(user)
        return user

    async def revoke_sessions(self, session: AsyncSession, user: User) -> None:
        user.token_version += 1
        await session.commit()


auth_service = AuthService()
