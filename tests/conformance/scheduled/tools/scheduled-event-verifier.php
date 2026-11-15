<?php
// Test-only driver. Loads Scheduled's own Central event code (SignedEventVerifier, CentralConfig, CentralException)
// from the Scheduled repository and answers two operations for the fixture generator:
//   sign    : HMAC-SHA256 hex over SignedEventVerifier::canonicalJson() of the unsigned envelope.
//   verdict : SignedEventVerifier::verify() outcome for a raw body at a fixed clock.
// Usage: php scheduled-event-verifier.php <scheduled core/app/Central directory> < requests.json
// Input: {"requests":[{"op":"sign","body":"{...}","secret":"..."}, {"op":"verdict","body":"{...}","secret":"...","now":123}]}
// Output: JSON array, one result per request, in order. No secret is echoed back.
declare(strict_types=1);

$root = $argv[1] ?? '';
if ($root === '' || !is_file($root . '/Events/SignedEventVerifier.php')) {
    fwrite(STDERR, "scheduled core/app/Central directory required\n");
    exit(2);
}
require_once $root . '/CentralException.php';
require_once $root . '/Config/CentralConfig.php';
require_once $root . '/Events/SignedEventVerifier.php';

use App\Central\CentralException;
use App\Central\Events\SignedEventVerifier;

$input = json_decode((string) stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$results = [];
foreach ($input['requests'] as $request) {
    if ($request['op'] === 'sign') {
        $object = json_decode($request['body'], false, 32, JSON_THROW_ON_ERROR);
        $results[] = [
            'signature' => hash_hmac('sha256', SignedEventVerifier::canonicalJson($object), $request['secret']),
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
