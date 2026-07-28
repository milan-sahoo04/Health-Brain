$sections = @(
    @{ sectionId = "wikisection:pattern-demo-1:majorInsights"; content = "- HbA1c and Walking show a moderate-confidence relationship (confidence: 59%)."; checksum = "ef5f71e0d4e467d9ef99a8cc1afd1ee307e1c6ecb9ad4979e28f0e7644e29ae0"; sectionKey = "majorInsights"; title = "Major Insights" },
    @{ sectionId = "wikisection:pattern-demo-1:primaryDrivers"; content = "Primary driver: HbA1c (confidence 59%)."; checksum = "e00562b2c09cb90d4655bb8d75549bc04fb8830832d523a2535b89aca3bd6b77"; sectionKey = "primaryDrivers"; title = "Primary Drivers" },
    @{ sectionId = "wikisection:pattern-demo-1:riskAssessment"; content = "Moderate: 1 tracked pattern is showing declining confidence and may need review."; checksum = "0dcf42580eb5a128c73072049b16c4fe7dc3d44e0ced677323db7ef99129e415"; sectionKey = "riskAssessment"; title = "Risk Assessment" },
    @{ sectionId = "wikisection:pattern-demo-1:confidenceAnalysis"; content = "- HbA1c and Walking show a moderate-confidence relationship: 58.8% (Moderate, trend: declining, 3 versions)."; checksum = "9f834bb7fef353ac5d09f922a9111651af144da0cb078560c75b4d8f6fd322f9"; sectionKey = "confidenceAnalysis"; title = "Confidence Analysis" }
)

foreach ($s in $sections) {
    $body = @{
        sectionId  = $s.sectionId
        content    = $s.content
        checksum   = $s.checksum
        patientId  = "pattern-demo-1"
        sectionKey = $s.sectionKey
        title      = $s.title
    } | ConvertTo-Json

    Write-Host "Embedding $($s.sectionKey)..."
    Invoke-RestMethod -Uri "http://localhost:8003/embed" -Method Post -ContentType "application/json" -Body $body
}
