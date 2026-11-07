<?php
declare(strict_types=1);

use Money\Currencies\ISOCurrencies;
use Money\Formatter\DecimalMoneyFormatter;
use Money\Money;

final class PdfFormat
{
    public static function money(Money $amount): string
    {
        $decimal = (new DecimalMoneyFormatter(new ISOCurrencies()))->format($amount);
        [$whole, $fraction] = array_pad(explode('.', $decimal, 2), 2, null);
        $whole = preg_replace('/\B(?=(\d{3})+(?!\d))/', '.', $whole);
        $currency = $amount->getCurrency()->getCode();
        return $whole . ($fraction === null ? '' : ',' . $fraction) . ' ' . ($currency === 'EUR' ? '€' : $currency);
    }

    /** pdfMake accepts PNG/JPEG; convert other GD-supported branding images to PNG. */
    public static function businessLogo($db, $cms, array $business): ?string
    {
        if (empty($business['instances_logo'])) return null;
        try {
            $db->where('s3files_id', (int)$business['instances_logo']);
            $db->where('instances_id', (int)$business['instances_id']);
            $db->where('s3files_meta_type', 5);
            if (!$db->has('s3files')) return null;

            $file = $cms->s3Passthrough($business['instances_logo']);
            if (!$file) return null;
            $bytes = $file['data'];
            $size = @getimagesizefromstring($bytes);
            if (!$size || $size[0] * $size[1] > 24_000_000) return null;
            if (in_array($size['mime'], ['image/png', 'image/jpeg'], true)) {
                return 'data:' . $size['mime'] . ';base64,' . base64_encode($bytes);
            }
            $image = @imagecreatefromstring($bytes);
            if (!$image) return null;
            imagesavealpha($image, true);
            ob_start();
            try {
                if (!imagepng($image)) return null;
                return 'data:image/png;base64,' . base64_encode(ob_get_contents());
            } finally {
                ob_end_clean();
            }
        } catch (Throwable $error) {
            error_log('PDF business logo unavailable: ' . get_class($error));
            return null;
        }
    }
}
