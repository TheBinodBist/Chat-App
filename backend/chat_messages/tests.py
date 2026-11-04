from unittest.mock import AsyncMock, MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIRequestFactory, force_authenticate

from conversation.models import Conversation, ConversationMember
from .views import message_view


class MessageBroadcastTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="sender",
            password="test-password",
            email="sender@example.com",
            user_name="sender",
            first_name="Sender",
            last_name="Test",
        )
        self.conversation = Conversation.objects.create(
            Conversation_type=Conversation.ConversationType.DIRECT,
            created_by=self.user,
        )
        ConversationMember.objects.create(
            Conversation=self.conversation,
            user=self.user,
        )
        self.factory = APIRequestFactory()

    @patch("chat_messages.views.get_channel_layer")
    def test_post_broadcasts_created_message_to_conversation_group(self, get_layer):
        channel_layer = MagicMock()
        channel_layer.group_send = AsyncMock()
        get_layer.return_value = channel_layer

        request = self.factory.post(
            f"/api/v1/messages/{self.conversation.id}/messages/",
            {"content": "Hello"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = message_view(request, self.conversation.id)

        self.assertEqual(response.status_code, 201)
        channel_layer.group_send.assert_awaited_once()
        group_name, event = channel_layer.group_send.await_args.args
        self.assertEqual(group_name, f"conversation_{self.conversation.id}")
        self.assertEqual(
            event,
            {
                "type": "chat_message",
                "message": {
                    "id": str(response.data["id"]),
                    "conversation_id": str(self.conversation.id),
                    "sender_id": str(self.user.pk),
                    "message": "Hello",
                    "created_at": event["message"]["created_at"],
                },
            },
        )
        self.assertEqual(
            parse_datetime(event["message"]["created_at"]),
            parse_datetime(response.data["created_at"]),
        )
