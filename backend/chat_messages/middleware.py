from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError


@database_sync_to_async
def get_user_from_token(token):
    User = get_user_model()

    try:
        access_token = AccessToken(token)
        user_id = access_token["user_id"]

        return User.objects.get(pk=user_id, is_active=True)
    except (TokenError, KeyError, ValueError, User.DoesNotExist):
        return None


class JWTAuthMiddleware:

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        token = query.get("token", [None])[0]

        user = None

        if token:
            user = await get_user_from_token(token)

        scope = dict(scope)
        scope["user"] = user

        return await self.app(scope, receive, send)
