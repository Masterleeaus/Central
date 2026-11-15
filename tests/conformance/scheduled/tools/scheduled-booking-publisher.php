<?php
// Test-only driver. Loads Scheduled's booking event publisher (BookingEventPublisher, BookingEventFacts,
// BookingEventEnvelope, BookingEventType) and its Central event verifier (SignedEventVerifier) from the Scheduled
// repository, then answers two operations for the fixture generator:
//   publish : records one booking event through BookingEventPublisher into an in-memory outbox, then builds the signed
//             body with BookingEventEnvelope::body(). Optional `tamper` edits the body afterwards (test cases only).
//   verdict : Scheduled's SignedEventVerifier outcome for a raw body at a fixed clock.
// Usage: php scheduled-booking-publisher.php <scheduled core/app directory> < requests.json
// Input: {"requests":[{"op":"publish","eventType":"booking_created","booking":{...},"revision":1,
//                      "correlationId":null,"eventId":"uuid","occurredAt":"2026-...Z","secret":"..."}, ...]}
// Output: JSON array, one result per request, in order. No secret is echoed back.
declare(strict_types=1);

$root = $argv[1] ?? '';
if ($root === '' || !is_file($root . '/Booking/Events/BookingEventPublisher.php')) {
    fwrite(STDERR, "scheduled core/app directory required\n");
    exit(2);
}

// Load only classes under App\ from the Scheduled tree. Nothing else is required, so no vendor code runs.
spl_autoload_register(static function (string $class) use ($root): void {
    if (strncmp($class, 'App\\', 4) !== 0) {
        return;
    }
    $file = $root . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

use App\Booking\Events\BookingEventEnvelope;
use App\Booking\Events\BookingEventOutboxStore;
use App\Booking\Events\BookingEventPublisher;
use App\Central\CentralException;
use App\Central\Events\SignedEventVerifier;
use DateTimeImmutable;
use DateTimeZone;

/** In-memory outbox. Holds rows exactly as Scheduled's store would receive them. */
final class ConformanceOutboxStore implements BookingEventOutboxStore
{
    /** @var array<string,array<string,mixed>> */
    public array $rows = [];

    public function find(string $idempotencyKey): ?array
    {
        return $this->rows[$idempotencyKey] ?? null;
    }

    public function insert(array $row): void
    {
        $this->rows[$row['idempotency_key']] = $row;
    }

    public function dueHeads(DateTimeImmutable $now, int $limit): array
    {
        return array_values($this->rows);
    }

    public function markPublished(string $eventId, DateTimeImmutable $at): void
    {
    }

    public function markFailed(string $eventId, int $attempts, DateTimeImmutable $nextAttemptAt, string $error, bool $dead): void
    {
    }
}

/** Replaces the signed body's field values without re-signing. Used only to build tampered fixtures. */
function applyTamper(string $body, array $tamper): string
{
    $object = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
    foreach ($tamper as $field => $value) {
        $object[$field] = $value;
    }

    return CentralCanonical::encode($object);
}

/** Same canonical form as Scheduled's CanonicalJson, used to re-encode a tampered body. */
final class CentralCanonical
{
    public static function encode(array $value): string
    {
        return json_encode(self::sort($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private static function sort(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map([self::class, 'sort'], $value);
        }
        ksort($value, SORT_STRING);
        $out = new \stdClass();
        foreach ($value as $name => $item) {
            $out->{(string) $name} = self::sort($item);
        }

        return $out;
    }
}

$input = json_decode((string) stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$results = [];
foreach ($input['requests'] as $request) {
    if ($request['op'] === 'publish') {
        $store = new ConformanceOutboxStore();
        $at = new DateTimeImmutable($request['occurredAt']);
        $eventId = $request['eventId'];
        $publisher = new BookingEventPublisher(
            $store,
            static fn (): DateTimeImmutable => $at->setTimezone(new DateTimeZone('UTC')),
            static fn (): string => $eventId,
        );
        try {
            $publisher->record(
                $request['eventType'],
                $request['booking'],
                (int) $request['revision'],
                $request['correlationId'] ?? null,
            );
        } catch (CentralException $error) {
            $results[] = ['published' => false, 'reason' => $error->reason];
            continue;
        }
        $row = array_values($store->rows)[0];
        $body = (new BookingEventEnvelope($request['secret']))->body($row);
        if (isset($request['tamper'])) {
            $body = applyTamper($body, $request['tamper']);
        }
        $results[] = [
            'published' => true,
            'idempotencyKey' => $row['idempotency_key'],
            'body' => $body,
        ];
        continue;
    }
    if ($request['op'] === 'verdict') {
        try {
            (new SignedEventVerifier($request['secret']))->verify($request['body'], (int) $request['now']);
            $results[] = ['accepted' => true];
        } catch (CentralException $error) {
            $results[] = ['accepted' => false, 'reason' => $error->reason];
        }
        continue;
    }
    fwrite(STDERR, "unknown op\n");
    exit(2);
}
echo json_encode($results, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
