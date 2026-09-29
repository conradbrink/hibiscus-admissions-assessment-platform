-- A campaign batch marks the recipient it is sending to as `skipped` with
-- exclusion_reason 'claimed', so two drains cannot send the same row. The
-- send then set the status to `sent` or `failed` but left the marker behind,
-- so the campaign's CSV export showed "claimed" as the reason for every
-- parent who was sent the message, and in place of the provider's error for
-- every one who failed. The code now clears it with the status; this clears
-- the rows already written. Only the marker is touched, only on rows that
-- finished: a row still claimed (`skipped`, 'claimed') is left for the
-- retry that releases it.
update public.campaign_recipients
   set exclusion_reason = null
 where exclusion_reason = 'claimed'
   and status in ('sent', 'failed');
