<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

final class PdfInvoiceDetails extends AbstractMigration
{
    public function change(): void
    {
        $this->table('instances')
            ->addColumn('instances_pdf_taxNumber', 'string', ['limit' => 40, 'null' => true])
            ->addColumn('instances_pdf_vatId', 'string', ['limit' => 20, 'null' => true])
            ->addColumn('instances_pdf_bankDetails', 'string', ['limit' => 500, 'null' => true])
            ->update();

        $this->table('s3files')
            ->addColumn('s3files_invoice_number', 'string', ['limit' => 64, 'null' => true])
            ->addIndex(['instances_id', 's3files_invoice_number'], ['unique' => true, 'name' => 's3files_business_invoice_number'])
            ->update();
    }
}
