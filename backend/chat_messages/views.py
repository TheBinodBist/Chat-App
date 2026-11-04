from django.shortcuts import get_object_or_404

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from conversation.models import Conversation
from .models import Message
from .serializers import MessageSerializer


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def message_view(request, conversation_id):
    conversation = get_object_or_404(
        Conversation,
        id=conversation_id,
    )


    is_member = conversation.members.filter(id=request.user.id).exists()

    if not is_member:
        return Response(
            {"error": "You are not a member of this conversation."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.method == "GET":
        messages = (
            Message.objects.filter(conservation=conversation)
            .select_related("sender")
            .order_by("created_at")
        )

        serializer = MessageSerializer(
            messages,
            many=True,
            context={"request": request},  
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    # Create a message.
    serializer = MessageSerializer(
        data=request.data,
        context={"request": request}, 
    )

    if serializer.is_valid():
        message = serializer.save(
            sender=request.user,
            conservation=conversation,
        )

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"conversation_{conversation.id}",
            {
                "type": "chat_message",
                "message": {
                    "id": str(message.id),
                    "conversation_id": str(conversation.id),
                    "sender_id": str(request.user.pk),
                    "message": message.content,
                    "created_at": message.created_at.isoformat(),
                },
            },
        )

        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
        )

    return Response(
        serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )
