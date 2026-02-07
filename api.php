<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$file = "data.txt";

if (!file_exists($file)) {
    file_put_contents($file, "");
}

function sanitize_input($input) {
    return str_replace("|", "", trim($input));
}

// SAVE FUNCTIONALITY
if (
    isset($_GET['productname']) &&
    isset($_GET['description']) &&
    isset($_GET['name']) &&
    isset($_GET['email']) &&
    isset($_GET['phonenum'])
) {
    $productname = sanitize_input($_GET['productname']);
    $description = sanitize_input($_GET['description']);
    $name        = sanitize_input($_GET['name']);
    $email       = sanitize_input($_GET['email']);
    $phonenum    = sanitize_input($_GET['phonenum']);

    $entry = "|" . $productname . "|" . $description . "|" .
             $name . "|" . $email . "|" . $phonenum . "|";

    file_put_contents($file, $entry, FILE_APPEND);

    echo json_encode([
        "status" => "success",
        "message" => "Item saved"
    ]);
    exit;
}

// SEARCH FUNCTIONALITY
if (isset($_GET['query'])) {

    $query = sanitize_input($_GET['query']);
    $content = file_get_contents($file);

    $parts = explode("|", $content);
    
    // Filter out empty parts to fix indexing issue with multiple entries
    $parts = array_values(array_filter($parts, function($part) {
        return trim($part) !== "";
    }));
    
    $items = [];

    // each record = 5 fields
    for ($i = 0; $i < count($parts) - 4; $i += 5) {
        $items[] = [
            "productname" => $parts[$i],
            "description" => $parts[$i + 1],
            "name"        => $parts[$i + 2],
            "email"       => $parts[$i + 3],
            "phonenum"    => $parts[$i + 4]
        ];
    }

    foreach ($items as &$item) {
        $item["distance"] = levenshtein(
            strtolower($query),
            strtolower($item["productname"])
        );
    }

    usort($items, function($a, $b) {
        return $a["distance"] <=> $b["distance"];
    });

    $top = array_slice($items, 0, 5);

    $result = array_map(function($item) {
        return [
            "productname" => $item["productname"],
            "description" => $item["description"],
            "name"        => $item["name"],
            "email"       => $item["email"],
            "phonenum"    => $item["phonenum"]
        ];
    }, $top);

    echo json_encode($result);
    exit;
}

echo json_encode([
    "status" => "error",
    "message" => "Invalid request"
]);
