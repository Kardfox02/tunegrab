import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings


USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=settings.password_min_length, max_length=256)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        if not USERNAME_PATTERN.fullmatch(value):
            raise ValueError("username may contain only letters, digits, '_' and '-'")
        return value


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=settings.password_min_length, max_length=256)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str


class AuthResponse(BaseModel):
    user: UserResponse
