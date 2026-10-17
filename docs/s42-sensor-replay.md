# S42 sensor scenario replay

Run one scenario against an active test shipment using the S41 endpoint. The JSON
fixtures contain the five Jira cases and their expected violation counts:
no excursion (0), 10 minutes (0), 45 minutes (1), two excursions separated by
exactly five minutes (2), and a midnight crossing (1).

From `backend`, with an existing test session supplied through the
`SENSOR_SESSION_COOKIE` environment variable:

```powershell
node scripts/simulate_sensor_s42.js --file test/fixtures/s42_jira_scenarios.json --scenario S42-JIRA-03 --endpoint http://127.0.0.1:3000/api/shipments/temperatures --cold-box CB-001
```

The script sends samples sequentially in file order without waiting between
measurement timestamps. It does not sort, resample, or retry readings. It stops
on the first HTTP error or invalid acknowledgment. Its output contains only the
scenario ID, number of samples, acknowledgments, and ignored readings; it never
prints the session cookie.

Relative `minute` values use the current time as an anchor. Explicit `timestamp`
values are preserved, including dates crossing midnight. `--base-time <ISO>` can
shift either format to a chosen test anchor while preserving relative intervals.
Choose an anchor within the active test shipment's lifecycle. Use a fresh test
shipment for each independent scenario, so the S41 ordering rule does not discard
samples from a new scenario as older than the previous scenario's readings.

The script reports S41 acknowledgments. Expected S43 violation counts remain in
the fixture and are checked by `cold_chain_s43_streaming_regression.test.js`.
End-to-end verification must additionally read the authorized S43 violation API
for the same shipment after integration; acknowledgments alone do not prove
detector persistence or tenant authorization.
