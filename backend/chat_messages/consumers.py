import json

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async

from conversation.models import Conversation, ConversationMember


class ChatConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        self.conversation_id = self.scope["url_route"]["kwargs"]["conversation_id"]
        self.user = self.scope["user"]

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        is_member = await self.check_membership()

        if not is_member:
            await self.close(code=4003)
            return

        # A unique room for this conversation
        self.room_group_name = f"chat_{self.conversation_id.replace('-', '')}"

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name,
        )

        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "room_group_name"):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name,
            )

    @database_sync_to_async
    def check_membership(self):
        return ConversationMember.objects.filter(
            conversation_id=self.conversation_id,
            user=self.user,
        ).exists()

    async def receive_json(self, content, **kwargs):
        event_type = content.get("type")

        if event_type == "typing_preview":
            text = content.get("text", "")

            if not isinstance(text, str) or len(text) > 2000:
                return

            # Send the live draft to other members in this conversation.
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "typing_preview_event",
                    "text": text,
                    "sender_id": str(self.user.pk),
                },
            )

        elif event_type == "typing_stop":
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "typing_stop_event",
                    "sender_id": str(self.user.pk),
                },
            )

    async def typing_preview_event(self, event):
        # Do not send the sender their own preview.
        if event["sender_id"] == str(self.user.pk):
            return

        await self.send_json(
            {
                "type": "typing_preview",
                "text": event["text"],
                "sender_id": event["sender_id"],
            }
        )

    async def typing_stop_event(self, event):
        if event["sender_id"] == str(self.user.pk):
            return

        await self.send_json(
            {
                "type": "typing_stop",
                "sender_id": event["sender_id"],
            }
        )
