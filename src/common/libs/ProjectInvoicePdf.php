<?php
declare(strict_types=1);

require_once __DIR__ . '/PdfFormat.php';

use Money\Money;

final class ProjectInvoicePdf
{
    public const TYPES = [
        'invoice' => ['title' => 'Rechnung', 'file' => 'rechnung', 'id' => 20, 'path' => 'uploads/PROJECT_INVOICES'],
        'quote' => ['title' => 'Angebot', 'file' => 'angebot', 'id' => 21, 'path' => 'uploads/PROJECT_QUOTES'],
        'deliveryNote' => ['title' => 'Lieferschein', 'file' => 'lieferschein', 'id' => 22, 'path' => 'uploads/PROJECT_DELIVERY_NOTES'],
    ];

    private static function date(string $value): ?DateTimeImmutable
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) return null;
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value ? $date : null;
    }

    public static function document(array $input, array $business, array $project, array $financials, bool $mayViewFinance): array
    {
        $errors = [];
        $value = static fn(string $key): string => is_string($input[$key] ?? null) ? trim($input[$key]) : '';
        $number = $value('invoiceNumber');
        $issued = self::date($value('invoiceDate'));
        $start = self::date($value('serviceStart'));
        $end = self::date($value('serviceEnd'));
        $due = self::date($value('invoiceDue'));
        $taxCase = $value('invoiceTaxCase');
        $taxNumber = trim((string)($business['instances_pdf_taxNumber'] ?? ''));
        $vatId = trim((string)($business['instances_pdf_vatId'] ?? ''));
        $rate = ['standard' => 19, 'reduced' => 7, 'smallBusiness' => 0][$taxCase] ?? null;

        if ($number === '' || mb_strlen($number) > 64 || preg_match('/[\x00-\x1f\x7f]/', $number)) {
            $errors[] = 'Eine einmalig vergebene Rechnungsnummer mit höchstens 64 Zeichen eingeben.';
            $number = '';
        }
        if (!$issued || $value('invoiceDate') > (new DateTimeImmutable('today', new DateTimeZone('Europe/Berlin')))->format('Y-m-d')) {
            $errors[] = 'Ein gültiges Rechnungsdatum eingeben, das nicht in der Zukunft liegt.';
        }
        if (!$start || ($value('serviceEnd') !== '' && (!$end || $end < $start))) {
            $errors[] = 'Ein gültiges Leistungsdatum oder einen gültigen Leistungszeitraum eingeben.';
        } elseif ($issued && ($end ?? $start) > $issued) {
            $errors[] = 'Die Leistung liegt nach dem Rechnungsdatum. Vorausrechnungen werden hier nicht unterstützt.';
        }
        if ($value('invoiceDue') !== '' && (!$due || ($issued && $due < $issued))) {
            $errors[] = 'Die Fälligkeit muss ein gültiges Datum ab dem Rechnungsdatum sein.';
        }
        if (trim((string)$business['instances_name']) === '' || trim((string)$business['instances_address']) === '') {
            $errors[] = 'Den vollständigen Namen und die Anschrift des Absenders in den Unternehmenseinstellungen hinterlegen.';
        }
        if (empty($project['projectsTypes_config_client']) || trim((string)$project['clients_name']) === '' || trim((string)$project['clients_address']) === '') {
            $errors[] = 'Dem Projekt einen Rechnungsempfänger mit vollständigem Namen und vollständiger Anschrift zuordnen.';
        }
        $validTaxNumber = preg_match('/^(?:\d{10,11}|\d{13})$/D', preg_replace('~[ /]~', '', $taxNumber));
        $validVatId = preg_match('/^DE\d{9}$/iD', str_replace(' ', '', $vatId));
        if (!$validTaxNumber && !$validVatId) {
            $errors[] = 'Eine deutsche Steuernummer oder USt-IdNr. in den Unternehmenseinstellungen hinterlegen.';
        }
        if ($rate === null) $errors[] = 'Einen unterstützten Steuerfall auswählen.';
        if ($value('invoiceConfirmed') !== '1') {
            $errors[] = 'Vollständige Anschriften, einheitliche Nettopreise und den gewählten Steuerfall bestätigen.';
        }

        $result = [
            'number' => $number, 'issued' => $issued?->format('d.m.Y'), 'start' => $start?->format('d.m.Y'),
            'end' => $end?->format('d.m.Y'), 'due' => $due?->format('d.m.Y'),
            'taxNumber' => $mayViewFinance && $validTaxNumber ? $taxNumber : '',
            'vatId' => $mayViewFinance && $validVatId ? $vatId : '', 'rate' => $rate,
            'bankDetails' => $mayViewFinance ? ($business['instances_pdf_bankDetails'] ?? '') : '',
            'taxNote' => $taxCase === 'smallBusiness' ? 'Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG.' : '',
            'rows' => [], 'totals' => null
        ];
        if (!$mayViewFinance) {
            $errors[] = 'Für die Rechnung sind ein Projekt mit Finanzdaten und die Berechtigung zur Ansicht der Zahlungen erforderlich.';
            return $result + ['errors' => $errors];
        }

        $net = $financials['payments']['subTotal'];
        if ($net->getCurrency()->getCode() !== 'EUR') $errors[] = 'Endgültige PDF-Rechnungen werden nur für Projekte in Euro unterstützt.';
        $sum = new Money('0', $net->getCurrency());
        $groups = array_merge($financials['assetsAssigned'], ...array_values(array_column($financials['assetsAssignedSUB'], 'assets')));
        $items = [];
        foreach ($groups as $group) {
            foreach ($group['assets'] as $asset) {
                $name = trim((string)$asset['assetTypes_name']);
                if ($name === '') $errors[] = 'Mindestens einem Material fehlt eine Positionsbezeichnung.';
                if ((int)$asset['manufacturers_id'] !== 1 && !empty($asset['manufacturers_name'])) {
                    $name = $asset['manufacturers_name'] . ' - ' . $name;
                }
                $unit = $asset['discountPrice'];
                $key = $name . "\0" . $unit->getAmount();
                $items[$key] ??= ['name' => $name, 'quantity' => 0, 'unit' => $unit];
                $items[$key]['quantity']++;
            }
        }
        foreach ($items as $item) {
            $total = $item['unit']->multiply($item['quantity']);
            $result['rows'][] = self::row('Materialmiete', $item['name'], $item['quantity'], $item['unit'], $total);
            $sum = $sum->add($total);
        }
        foreach (['subHire' => 'Zumietung', 'sales' => 'Verkauf', 'staff' => 'Personal'] as $key => $label) {
            foreach ($financials['payments'][$key]['ledger'] as $payment) {
                $name = trim((string)$payment['payments_comment']);
                $quantity = $payment['payments_quantity'];
                if ($name === '' || !is_numeric($quantity) || $quantity <= 0) {
                    $errors[] = 'Bei mindestens einer Finanzposition fehlen eine eindeutige Beschreibung oder eine gültige Menge.';
                }
                $result['rows'][] = self::row($label, $name, $quantity, $payment['payments_amount'], $payment['payments_amountTotal']);
                $sum = $sum->add($payment['payments_amountTotal']);
            }
        }
        if (!$result['rows']) $errors[] = 'Mindestens eine abrechenbare Position erfassen.';
        if (!$sum->equals($net) || $net->isNegative()) $errors[] = 'Die Positionssummen ergeben kein gültiges Nettoentgelt.';
        $received = $financials['payments']['received']['total'];
        if ($financials['payments']['received']['ledger']) {
            $errors[] = 'Das Projekt enthält Zahlungseingänge. Bereits abgerechnete Anzahlungen und Teilrechnungen müssen separat geprüft werden.';
        }
        if ($rate !== null) {
            $vat = $net->multiply((string)$rate)->divide('100', Money::ROUND_HALF_UP);
            $gross = $net->add($vat);
            $result['totals'] = [
                'net' => PdfFormat::money($net), 'vat' => PdfFormat::money($vat),
                'gross' => PdfFormat::money($gross), 'received' => $received->isZero() ? null : PdfFormat::money($received),
            ];
        }
        return $result + ['errors' => array_values(array_unique($errors))];
    }

    private static function row(string $category, string $name, $quantity, Money $unit, Money $total): array
    {
        return ['category' => $category, 'name' => $name, 'quantity' => $quantity,
            'unit' => PdfFormat::money($unit), 'total' => PdfFormat::money($total)];
    }
}
