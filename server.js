var express = require('express');
var bodyParser = require('body-parser');
var path = require('path');
var Promise = require('bluebird');
require("date-format-lite");

var port = 1337;
var app = express();
var mysql = require('promise-mysql');

var db = mysql.createPool({
	host: 'localhost',
	user: 'root',
	password: '',
	database: 'gantt-howto-node'
});

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({extended: true}));

app.listen(port, function () {
	console.log("Server is running on port " + port + "...");
});

app.get("/data", function (req, res) {
	Promise.all([
		db.query("SELECT * FROM gantt_tasks ORDER BY sortorder ASC"),
		db.query("SELECT * FROM gantt_links")
	]).then(function (results) {
		var tasks = results[0],
			links = results[1];

		for (var i = 0; i < tasks.length; i++) {
			tasks[i].start_date = tasks[i].start_date.format("YYYY-MM-DD hh:mm:ss");
			tasks[i].open = true;
		}

		res.send({
			data: tasks,
			collections: {links: links}
		});

	}).catch(function (error) {
		sendResponse(res, "error", null, error);
	});
});


// add new task
app.post("/data/task", function (req, res) { // adds new task to database
	var task = getTask(req.body);

	db.query("SELECT MAX(sortorder) AS maxOrder FROM gantt_tasks")
		.then(function (result) { /*!*/ // assign max sort order to new task
			var orderIndex = (result[0].maxOrder || 0) + 1;
			return db.query("INSERT INTO gantt_tasks(text, start_date, duration, progress, parent, sortorder) VALUES (?,?,?,?,?,?)",
				[task.text, task.start_date, task.duration, task.progress, task.parent, orderIndex]);
		})
		.then(function (result) {
			sendResponse(res, "inserted", result.insertId);
		})
		.catch(function (error) {
			sendResponse(res, "error", null, error);
		});
});

// update task
app.put("/data/task/:id", function (req, res) {
	var sid = req.params.id,
		target = req.body.target,
		task = getTask(req.body);

	Promise.all([
		db.query("UPDATE gantt_tasks SET text = ?, start_date = ?, duration = ?, progress = ?, parent = ? WHERE id = ?",
			[task.text, task.start_date, task.duration, task.progress, task.parent, sid]),
		updateOrder(sid, target)
	])
		.then(function (result) {
			sendResponse(res, "updated");
		})
		.catch(function (error) {
			sendResponse(res, "error", null, error);
		});
});

function updateOrder(taskId, target) {
	var nextTask = false;
	var targetOrder;

	target = target || "";

	if (target.startsWith("next:")) {
		target = target.substr("next:".length);
		nextTask = true;
	}

	return db.query("SELECT * FROM gantt_tasks WHERE id = ?",
		[target])
		.then(function (result) {
			if (!result[0])
				return Promise.resolve();

			targetOrder = result[0].sortorder;
			if (nextTask)
				targetOrder++;

			return db.query("UPDATE gantt_tasks SET sortorder = sortorder + 1 WHERE sortorder >= ?",
				[targetOrder])
				.then(function (result) {
					return db.query("UPDATE gantt_tasks SET sortorder = ? WHERE id = ?",
						[targetOrder, taskId]);
				});
		});
}

// delete task
app.delete("/data/task/:id", function (req, res) {
	var sid = req.params.id;
	db.query("DELETE FROM gantt_tasks WHERE id = ?", [sid])
		.then(function (result) {
			sendResponse(res, "deleted");
		})
		.catch(function (error) {
			sendResponse(res, "error", null, error);
		});
});

// add link
app.post("/data/link", function (req, res) {
	var link = getLink(req.body);

	db.query("INSERT INTO gantt_links(source, target, type) VALUES (?,?,?)",
		[link.source, link.target, link.type])
		.then(function (result) {
			sendResponse(res, "inserted", result.insertId);
		})
		.catch(function (error) {
			sendResponse(res, "error", null, error);
		});
});

// update link
app.put("/data/link/:id", function (req, res) {
	var sid = req.params.id,
		link = getLink(req.body);

	db.query("UPDATE gantt_links SET source = ?, target = ?, type = ? WHERE id = ?",
		[link.source, link.target, link.type, sid])
		.then(function (result) {
			sendResponse(res, "updated");
		})
		.catch(function (error) {
			sendResponse(res, "error", null, error);
		});
});

// delete link
app.delete("/data/link/:id", function (req, res) {
	var sid = req.params.id;
	db.query("DELETE FROM gantt_links WHERE id = ?",
		[sid])
		.then(function (result) {
			sendResponse(res, "deleted");
		})
		.catch(function (error) {
			sendResponse(res, "error", null, error);
		});
});


function getTask(data) {
	return {
		text: data.text,
		start_date: data.start_date.date("YYYY-MM-DD"),
		duration: data.duration,
		progress: data.progress || 0,
		parent: data.parent
	};
}

function getLink(data) {
	return {
		source: data.source,
		target: data.target,
		type: data.type
	};
}

function sendResponse(res, action, tid, error) {

	if (action == "error")
		console.log(error);

	var result = {
		action: action
	};
	if (tid !== undefined && tid !== null)
		result.tid = tid;

	res.send(result);
}