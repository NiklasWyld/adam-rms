<?php
/** Return a safe HTTPS frame origin, or null for an invalid calendar embed URL. */
function calendarEmbedOrigin($url)
{
    if (!is_string($url) or !filter_var($url, FILTER_VALIDATE_URL)) return null;
    $parts = parse_url($url);
    if (!$parts or ($parts['scheme'] ?? '') !== 'https' or empty($parts['host']) or isset($parts['user']) or isset($parts['pass'])) return null;
    return 'https://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
}
