---
name: Messaging and queues
description: Message and job-queue defects — early acks, non-idempotent consumers, dual writes, poison loops, ordering and lease expiry, offset commits, batch partial failures, unconfirmed publishes and payload evolution.
category: practice
priority: 55
tier: essential
tags:
  - CWE-362
  - CWE-400
  - CWE-754
activation:
  files:
    - "**/*{consumer,Consumer,subscriber,Subscriber,producer,Producer,outbox,Outbox}*.{ts,js,mjs,cjs,py,go,java,kt,cs,rb,php,ex,exs,scala,rs}"
    - "**/{consumers,subscribers,producers,queues,outbox,jobs,Jobs}/**/*.{ts,js,mjs,cjs,py,go,java,kt,cs,rb,php,ex,exs,scala,rs}"
  content:
    - (?:from\s+|require\(\s*)['"](?:kafkajs|@confluentinc/kafka-javascript|node-rdkafka|@platformatic/kafka|amqplib|amqp-connection-manager|rascal|nats|@nats-io/[\w-]+|bullmq|bull|bee-queue|@nestjs/(?:bullmq|bull|microservices)|@google-cloud/pubsub|@azure/service-bus|@aws-sdk/client-(?:sqs|sns|kinesis|eventbridge)|sqs-consumer|mqtt)['"]
    - \b(?:from|import)\s+(?:confluent_kafka|aiokafka|kafka|pika|aio_pika|aiormq|kombu|celery|faststream|dramatiq|rq|arq|taskiq|nats|google\.cloud\.pubsub_v1|azure\.servicebus)\b|\bfrom\s+google\.cloud\s+import\s+pubsub\b|\.(?:client|resource)\(\s*['"](?:sqs|sns|kinesis)['"]
    - '"(?:github\.com/(?:IBM/sarama|Shopify/sarama|twmb/franz-go|segmentio/kafka-go|confluentinc/confluent-kafka-go|rabbitmq/amqp091-go|streadway/amqp|nats-io/nats\.go|ThreeDotsLabs/watermill|hibiken/asynq)|cloud\.google\.com/go/pubsub|github\.com/aws/aws-sdk-go-v2/service/(?:sqs|sns|kinesis))'
    - "@(?:KafkaListener|RabbitListener|SqsListener|JmsListener|Incoming|Outgoing|EventPattern|MessagePattern|Processor|shared_task|app\\.task)\\b|#\\[AsMessageHandler\\b|\\b(?:KafkaTemplate|KafkaConsumer|KafkaProducer|ConsumerRecord|RabbitTemplate|JmsTemplate|SqsClient|SqsAsyncClient|ServiceBusProcessor|ServiceBusClient|ConsumerBuilder|ProducerBuilder|MassTransit|NServiceBus|ConsumeContext|MessageBusInterface|ApplicationJob|Sidekiq::(?:Job|Worker)|Oban|Broadway)\\b|\\bIConsumer<"
    - \.(?:ack|nack|basicAck|basicNack|BasicAck|BasicNack|basic_ack|basic_nack|commitOffsets|commitSync|commitAsync|deleteMessage|delete_message|changeMessageVisibility|sendMessageBatch|send_message_batch|apply_async|perform_async|perform_later)\(|(?<!Promise)\.reject\(\s*\w+\s*,|\b(?:Send|Delete|Receive|ChangeMessageVisibility)Message(?:Batch)?Command\b|\bSQS(?:Event|Handler|BatchResponse)\b|\bXREADGROUP\b|\bxReadGroup\(
    - \b(?:autoAck|auto_ack|noAck|no_ack|enable\.auto\.commit|acks_late|prefetch_count|basicQos|VisibilityTimeout|visibility_timeout|MessageGroupId|MessageDeduplicationId|batchItemFailures|ReportBatchItemFailures|x-dead-letter-exchange|deadLetter\w*|max\.poll\.interval\.ms|AckWait|MaxDeliver|ShouldQueue)\b
  examples:
    - 'import { Kafka } from "kafkajs";'
    - 'from celery import shared_task'
    - 'import "github.com/segmentio/kafka-go"'
    - '@KafkaListener(topics = "orders")'
    - 'channel.basicAck(deliveryTag, false);'
    - 'const params = { QueueUrl: url, VisibilityTimeout: 30 };'
---
- **Ack before work**: `autoAck`/`noAck`, auto-commit while work runs elsewhere, SQS delete before processing, Celery's default early ack, un-awaited `eachMessage` work → crashes lose messages. Fix: ack after completion.
- **Non-idempotent consumer**: redeliveries, rebalances and producer retries handled without dedupe key, unique constraint or state check → double charges, duplicate emails. Fix: idempotency key, upsert.
- **Dual write**: publish or enqueue inside an uncommitted transaction, or after commit without an outbox → phantom or lost events, jobs reading missing rows. Fix: transactional outbox, after-commit hooks.
- **Poison message**: `nack(requeue=true)` or rethrow with no attempt cap or DLQ; errors swallowed then acked → hot redelivery loops or silent loss. Fix: capped retries with backoff, then a DLQ.
- **Ordering**: order assumed across partitions, standard SQS queues or parallel consumers; Kafka key or FIFO `MessageGroupId` missing, changed or random → older updates overwrite newer ones. Fix: key by entity, version checks.
- **Lease expiry**: work outlasting SQS visibility timeout, Kafka `max.poll.interval.ms`, Pub/Sub ack deadline or RabbitMQ `consumer_timeout` → redelivery mid-flight, rebalances. Fix: extend leases, smaller batches.
- **Offset commit**: committing the processed offset rather than offset+1, KafkaJS string offsets concatenated (`"42" + 1` is `"421"`), a batch's last offset after earlier failures → reprocessed or skipped messages. Fix: commit offset+1 after success.
- **Batch partial failure**: SQS Lambda handler throwing for one record without `batchItemFailures`; `Failed` entries of `SendMessageBatch` or `PutRecords` unchecked → whole-batch retries or silent loss. Fix: report and retry per entry.
- **Unconfirmed publish**: `send`/`publish` not awaited, no RabbitMQ publisher confirms, transient messages, Kafka `acks=0|1`, core NATS for durable events, no `flush()` before exit → lost messages. Fix: await confirms, `acks=all`, JetStream.
- **Payload evolution**: renamed, removed or newly required fields while old messages sit in queues, topics or DLQs and services deploy separately → poison messages, failed replays. Fix: additive changes, versioned payloads.
