from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import (
    AuthenticationFailed,
    InvalidToken,
    TokenError,
)


@database_sync_to_async
def get_user_from_token(token):
    try:
        jwt_auth = JWTAuthentication()
        validated_token = jwt_auth.get_validated_token(token.encode("utf-8"))
        return jwt_auth.get_user(validated_token)

    except (InvalidToken, TokenError, AuthenticationFailed):
        return AnonymousUser()


class JWTAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode("utf-8")
        query_params = parse_qs(query_string)

        tokens = query_params.get("token", [])
        token = tokens[0] if tokens else None

        # Safe debugging: never print the JWT itself.
        print("WebSocket path:", scope.get("path"))
        print("Query parameter names:", list(query_params.keys()))
        print("JWT token received:", bool(token))

        if token:
            user = await get_user_from_token(token)
            print("JWT resolved user:", user)
            scope["user"] = user
        else:
            scope["user"] = AnonymousUser()

        print(
            "JWT middleware authenticated:",
            scope["user"].is_authenticated,
        )

        return await self.app(scope, receive, send)
