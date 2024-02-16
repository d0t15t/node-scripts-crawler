const puppeteer = require("puppeteer")
const sqlite3 = require("sqlite3").verbose()

// Initialize DB
const db = new sqlite3.Database("./jsdatabase.db", (err) => {
  if (err) console.error("Error opening database", err)
  else {
    console.log("Database opened")
    db.run(
      "CREATE TABLE IF NOT EXISTS scripts (id INTEGER PRIMARY KEY AUTOINCREMENT, page_url TEXT, script_url TEXT)"
    )
  }
})
async function crawlPage(url, depth = 0, visited = new Set()) {
  if (depth > 2 || visited.has(url)) return // Limit depth and avoid loops
  visited.add(url)

  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "networkidle2" })

  const scriptUrls = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script[src]"))
    return scripts.map((s) => s.src)
  })

  for (const scriptUrl of scriptUrls) {
    db.run(
      "INSERT INTO scripts (page_url, script_url) VALUES (?, ?)",
      [url, scriptUrl],
      function (err) {
        if (err) return console.log(err.message)
        console.log(`A row has been inserted with rowid ${this.lastID}`)
      }
    )
  }

  // Extract the base URL to check for internal links
  const baseUrl = new URL(url).origin

  // Find all links and crawl them too, only if they are internal
  const links = await page.evaluate(
    (baseUrl) =>
      Array.from(document.querySelectorAll("a"))
        .map((a) => a.href)
        .filter((href) => href.startsWith(baseUrl)),
    baseUrl
  )

  await browser.close()

  for (const link of links) {
    await crawlPage(link, depth + 1, visited)
  }
}

function printScriptsQuery() {
  return "SELECT script_url, GROUP_CONCAT(id) AS ids, GROUP_CONCAT(page_url) AS page_urls FROM scripts GROUP BY script_url ORDER BY script_url"
}

function printScripts() {
  console.log("Listing all scripts:")
  let rowNum = 1
  db.each(printScriptsQuery(), (err, row) => {
    if (err) console.error(err.message)
    else
      console.log(
        `${rowNum++}. ${row.script_url}`,
        "\n",
        `Sources: ${row.page_urls}`,
        "\n"
      )
  })
}

// A helper function to print scripts from a specific URL
function printScriptsFromUrl(url) {
  console.log(`Listing all scripts from ${url}:`)
  let rowNum = 1
  db.each(
    "SELECT id, script_url FROM scripts WHERE page_url = ?",
    [url],
    (err, row) => {
      if (err) console.error(err.message)
      else console.log(`${rowNum++}. ${row.script_url} - ID: ${row.id}`)
    }
  )
}

function emptyDatabase() {
  db.run("DELETE FROM scripts", function (err) {
    if (err) console.error(err.message)
    else console.log("Database emptied successfully.")
  })
}

function saveToFile(filepath = null) {
  const fs = require("fs")
  // const db = new sqlite3.Database("path/to/your/database.db") // Ensure you have a db instance
  const file = fs.createWriteStream(filepath || "scripts.txt")
  file.on("error", (err) => console.error(err.message))

  // Use db.all to fetch all rows at once
  db.all(printScriptsQuery(), [], (err, rows) => {
    if (err) {
      console.error(err.message)
    } else {
      let rowNum = 1
      rows.forEach((row) => {
        // Assuming you want to list each script URL followed by the pages it was found on
        file.write(
          `${rowNum++}. ${row.script_url}\nSources: ${row.page_urls}\n`
        )
      })
      file.end() // Move file.end() here to ensure it's called after all writes
    }
  })
}

// Command line arguments
const args = process.argv.slice(2)
if (args.length === 0) {
  console.log(
    "Usage: node crawler.js <url> to crawl, node crawler.js list to print all scripts, or node crawler.js empty to empty the database."
  )
} else if (args[0] === "list") {
  url = args[1] || null
  if (url) printScriptsFromUrl(url)
  else printScripts()
} else if (args[0] === "save") {
  saveToFile()
} else if (args[0] === "empty") {
  emptyDatabase()
} else {
  crawlPage(args[0]).then(() => console.log("Crawling finished"))
}
