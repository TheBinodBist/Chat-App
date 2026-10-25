from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import ConversationMember, Message


class ConversationConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        self.conversation_id = str(self.scope["url_route"]["kwargs"]["conversation_id"])
        user = self.scope["user"]

        print("WebSocket user:", user)
        print("Authenticated:", user.is_authenticated)
        print("Conversation ID:", self.conversation_id)

        # 1. Check authentication
        if not user.is_authenticated:
            print("Rejected: user is not authenticated")
            await self.close(code=4401)
            return

        # 2. Check conversation membership
        is_member = await self.check_membership(user.id)

        if not is_member:
            print("Rejected: user is not a conversation member")
            await self.close(code=4403)
            return

        # 3. Join the conversation's channel group
        self.group_name = f"conversation_{self.conversation_id}"

        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name,
        )

        # 4. Accept the WebSocket connection
        await self.accept()
        print("WebSocket connected successfully!")

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(
                self.group_name,
                self.channel_name,
            )

    async def receive_json(self, data, **kwargs):
        content = data.get("message", "").strip()

        if not content or len(content) > 10000:
            await self.send_json(
                {
                    "type": "error",
                    "message": "Message must contain 1–10000 characters.",
                }
            )
            return

        user = self.scope["user"]

        # Save the message to the database
        message = await self.create_message(
            user_id=user.id,
            content=content,
        )

        # Broadcast to every connected member of this conversation
        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "chat_message",
                "message": message,
            },
        )

    async def chat_message(self, event):
        await self.send_json(
            {
                "type": "message",
                **event["message"],
            }
        )

    @database_sync_to_async
    def check_membership(self, user_id):
        return ConversationMember.objects.filter(
            Conversation_id=self.conversation_id,
            user_id=user_id,
        ).exists()

    @database_sync_to_async
    def create_message(self, user_id, content):
        message = Message.objects.create(
            conversation_id=self.conversation_id,
            sender_id=user_id,
            content=content,
        )

        return {
            "id": str(message.id),
            "conversation_id": str(message.conversation_id),
            "sender_id": user_id,
            "message": message.content,
            "created_at": message.created_at.isoformat(),
        }
