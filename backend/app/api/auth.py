import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.rate_limit import InMemoryRateLimiter
from app.schemas.auth import AuthResponse, ChangePasswordRequest, Credentials, UserResponse
from app.services.auth_service import InvalidCredentialsError, UsernameTakenError, auth_service


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
login_limiter = InMemoryRateLimiter(settings.login_rate_limit, settings.login_rate_window_seconds)


def set_session_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=auth_service.create_token(user),
        max_age=settings.auth_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.production,
        path="/",
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED, summary="Register a user")
async def register(
    credentials: Credentials,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        user = await auth_service.register(session, credentials.username, credentials.password)
    except UsernameTakenError:
        raise HTTPException(status_code=409, detail="Username is already registered") from None
    set_session_cookie(response, user)
    logger.info("User registered: %s", user.username)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse, summary="Log in")
async def login(
    request: Request,
    credentials: Credentials,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    client_host = request.client.host if request.client else "unknown"
    if not login_limiter.allow(client_host):
        raise HTTPException(status_code=429, detail="Too many login attempts")
    try:
        user = await auth_service.authenticate(session, credentials.username, credentials.password)
    except InvalidCredentialsError:
        raise HTTPException(status_code=401, detail="Invalid username or password") from None
    set_session_cookie(response, user)
    logger.info("User logged in: %s", user.username)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Log out everywhere")
async def logout(
    response: Response,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await auth_service.revoke_sessions(session, user)
    response.delete_cookie(settings.auth_cookie_name, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/change-password", response_model=AuthResponse, summary="Change password")
async def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        user = await auth_service.change_password(
            session, user, payload.current_password, payload.new_password
        )
    except InvalidCredentialsError:
        raise HTTPException(status_code=401, detail="Current password is invalid") from None
    set_session_cookie(response, user)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse, summary="Get current user")
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)
