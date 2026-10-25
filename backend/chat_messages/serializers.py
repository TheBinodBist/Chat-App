from rest_framework import serializers
from .models import Message


class MessageSerializer(serializers.ModelSerializer):
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "conservation",
            "sender",
            "content",
            "created_at",
            "is_mine",
        ]
        read_only_fields = [
            "id",
            "conservation",
            "sender",
            "created_at",
        ]

    def get_is_mine(self, obj):
        request = self.context.get("request")
        return request is not None and obj.sender_id == request.user.pk
